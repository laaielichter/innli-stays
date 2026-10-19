<?php
/**
 * Plugin Name:       INNLI – AI agent access for your accommodation
 * Description:       Connects your website to your INNLI accommodation passport: structured data from confirmed facts, a visible fact list, AI crawler settings and reporting of bookings made through AI agents.
 * Version:           2.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            INNLI
 * License:           GPL-2.0-or-later
 * Text Domain:       innli
 * Domain Path:       /languages
 */

if (!defined('ABSPATH')) {
    exit;
}

define('INNLI_VERSION', '2.0.0');
define('INNLI_REF_COOKIE', 'innli_ref');

final class Innli_Plugin
{
    const OPTION = 'innli_settings';
    const CRAWLER_OPTION = 'innli_crawler_visits';

    /** Search crawlers make the site eligible for AI search answers; training crawlers do not. */
    const SEARCH_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot'];
    const TRAINING_BOTS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot'];

    public static function defaults(): array
    {
        return [
            // The address of the buyer's own INNLI installation; there is no central default.
            'api_url' => '',
            'property_id' => '',
            'webhook_secret' => '',
            'output_jsonld' => 1,
            'allow_search_bots' => 1,
            'block_training_bots' => 0,
            'booking_ref_param' => 'booking_id',
            'amount_param' => '',
        ];
    }

    public static function settings(): array
    {
        $saved = get_option(self::OPTION, []);
        return array_merge(self::defaults(), is_array($saved) ? $saved : []);
    }

    /** Both the INNLI address and the property ID are filled in. */
    public static function configured(): bool
    {
        $s = self::settings();
        return $s['api_url'] !== '' && $s['property_id'] !== '';
    }

    /** Why the last call to INNLI failed, for the settings page. */
    private static $last_error = '';

    public static function init(): void
    {
        add_action('init', [__CLASS__, 'load_textdomain']);
        add_action('init', [__CLASS__, 'capture_ref']);
        add_action('wp_head', [__CLASS__, 'output_jsonld']);
        add_action('wp_head', [__CLASS__, 'output_verification'], 1);
        add_action('template_redirect', [__CLASS__, 'count_crawler']);
        add_filter('robots_txt', [__CLASS__, 'robots_txt'], 20, 2);
        add_shortcode('innli_facts', [__CLASS__, 'shortcode_facts']);
        add_shortcode('innli_conversion', [__CLASS__, 'shortcode_conversion']);
        add_shortcode('innli_request', [__CLASS__, 'shortcode_request_form']);
        // Dutch name, kept for existing sites.
        add_shortcode('innli_aanvraag', [__CLASS__, 'shortcode_request_form']);
        // For booking plugins: do_action('innli_report_booking', $booking_reference, $amount);
        add_action('innli_report_booking', [__CLASS__, 'report_booking'], 10, 2);

        if (is_admin()) {
            add_action('admin_menu', [__CLASS__, 'admin_menu']);
            add_action('admin_init', [__CLASS__, 'register_settings']);
            add_action('admin_notices', [__CLASS__, 'setup_notice']);
            add_filter('plugin_action_links_' . plugin_basename(__FILE__), [__CLASS__, 'action_links']);
        }
    }

    public static function load_textdomain(): void
    {
        load_plugin_textdomain('innli', false, dirname(plugin_basename(__FILE__)) . '/languages');
    }

    /** Language of the site (nl, en, de or fr) for the texts INNLI returns. */
    private static function site_lang(): string
    {
        $lang = substr(determine_locale(), 0, 2);
        return in_array($lang, ['nl', 'en', 'de', 'fr'], true) ? $lang : 'en';
    }

    // ------------------------------------------------------------- API

    private static function api_get(string $path)
    {
        $s = self::settings();
        if (!self::configured()) {
            return null;
        }
        $lang = self::site_lang();
        $cache_key = 'innli_' . md5($s['api_url'] . $s['property_id'] . $path . $lang);
        $cached = get_transient($cache_key);
        if ($cached !== false) {
            return $cached;
        }
        $url = trailingslashit($s['api_url']) . 'api/public/properties/' . rawurlencode($s['property_id']) . '/' . $path . '?lang=' . $lang;
        $res = wp_remote_get($url, ['timeout' => 5, 'headers' => ['accept' => 'application/json']]);
        if (is_wp_error($res)) {
            self::$last_error = $res->get_error_message();
        } elseif (wp_remote_retrieve_response_code($res) !== 200) {
            self::$last_error = wp_remote_retrieve_response_code($res) === 404
                ? __('INNLI does not know this property ID, or the accommodation is not published (switch "Visible to agents" on in the INNLI dashboard).', 'innli')
                : sprintf(__('INNLI answered with HTTP %d.', 'innli'), (int) wp_remote_retrieve_response_code($res));
        }
        if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) {
            // Short negative cache so a hiccup does not slow every page view.
            set_transient($cache_key, null, 5 * MINUTE_IN_SECONDS);
            return null;
        }
        $data = json_decode(wp_remote_retrieve_body($res), true);
        set_transient($cache_key, $data, HOUR_IN_SECONDS);
        return $data;
    }

    public static function flush_cache(): void
    {
        $s = self::settings();
        foreach (['jsonld', 'passport', 'site-verification'] as $path) {
            foreach (['nl', 'en', 'de', 'fr'] as $lang) {
                delete_transient('innli_' . md5($s['api_url'] . $s['property_id'] . $path . $lang));
            }
        }
    }

    // ------------------------------------------------------------- Structured data & visible facts

    /**
     * JSON-LD built by INNLI from owner-confirmed facts only. Pair it with the
     * [innli_facts] shortcode so structured data matches the visible page.
     */
    public static function output_jsonld(): void
    {
        $s = self::settings();
        if (!$s['output_jsonld'] || !(is_front_page() || is_home())) {
            return;
        }
        $ld = self::api_get('jsonld');
        if (!is_array($ld)) {
            return;
        }
        echo "\n<script type=\"application/ld+json\">" . wp_json_encode($ld, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) . "</script>\n";
    }

    /**
     * Proves to AI agents that this website belongs to the owner of the INNLI
     * passport: INNLI checks for this tag and then marks the website as
     * verified in every search result. Only on the home page, where INNLI looks.
     */
    public static function output_verification(): void
    {
        if (!(is_front_page() || is_home())) {
            return;
        }
        $v = self::api_get('site-verification');
        if (!is_array($v) || empty($v['token']) || !preg_match('/^innli-[a-z0-9-]{4,60}$/', (string) $v['token'])) {
            return;
        }
        echo "\n<meta name=\"innli-site-verification\" content=\"" . esc_attr($v['token']) . "\">\n";
    }

    /** [innli_facts] or [innli_facts unit="garden-room"] */
    public static function shortcode_facts($atts): string
    {
        $atts = shortcode_atts(['unit' => ''], $atts, 'innli_facts');
        $passport = self::api_get('passport');
        if (!is_array($passport)) {
            return '';
        }
        $facts = $passport['facts'] ?? [];
        if ($atts['unit'] !== '') {
            $facts = [];
            foreach ($passport['units'] ?? [] as $unit) {
                if ($unit['id'] === $atts['unit']) {
                    $facts = $unit['facts'];
                }
            }
        }
        if (!$facts) {
            return '';
        }
        static $styled = false;
        // Minimal layout that follows the theme's fonts and colours; themes can override .innli-facts.
        $out = $styled ? '' : '<style>.innli-facts{display:grid;grid-template-columns:minmax(10em,1fr) 2fr;gap:.35em 1.2em;margin:1em 0}.innli-facts dt{font-weight:600}.innli-facts dd{margin:0}@media(max-width:600px){.innli-facts{grid-template-columns:1fr}.innli-facts dd{margin-bottom:.5em}}</style>';
        $styled = true;
        $out .= '<dl class="innli-facts">';
        foreach ($facts as $fact) {
            $out .= '<dt>' . esc_html($fact['label']) . '</dt><dd>' . esc_html($fact['display']) . '</dd>';
        }
        return $out . '</dl>';
    }

    /**
     * [innli_request] embeds the availability request form of the INNLI stay page,
     * in the language of the site. [innli_request height="1100"] to change the height.
     */
    public static function shortcode_request_form($atts): string
    {
        $atts = shortcode_atts(['height' => '', 'hoogte' => '950'], $atts, 'innli_request');
        $height = (int) ($atts['height'] !== '' ? $atts['height'] : $atts['hoogte']);
        $s = self::settings();
        if (!self::configured()) {
            return current_user_can('manage_options') ? '<p class="innli-notice"><em>' . esc_html__('INNLI: fill in the INNLI address and property ID under Settings → INNLI to show the request form here.', 'innli') . '</em></p>' : '';
        }
        $src = trailingslashit($s['api_url']) . 'verblijf/' . rawurlencode($s['property_id']) . '?embed=1&lang=' . self::site_lang();
        // Pass a guest's agent reference through, so the request is attributed to that agent.
        if (isset($_COOKIE[INNLI_REF_COOKIE]) && self::valid_ref(sanitize_text_field(wp_unslash($_COOKIE[INNLI_REF_COOKIE])))) {
            $src .= '&ref=' . rawurlencode(sanitize_text_field(wp_unslash($_COOKIE[INNLI_REF_COOKIE])));
        }
        $origin = wp_parse_url($s['api_url'], PHP_URL_SCHEME) . '://' . wp_parse_url($s['api_url'], PHP_URL_HOST) . (wp_parse_url($s['api_url'], PHP_URL_PORT) ? ':' . wp_parse_url($s['api_url'], PHP_URL_PORT) : '');
        // The form reports its height, so the frame grows and shrinks with it (no inner scrollbar).
        $resize = '<script>(function(){if(window.innliResize)return;window.innliResize=1;addEventListener("message",function(e){if(e.origin!==' . wp_json_encode($origin) . '||!e.data||e.data.innli!=="height")return;document.querySelectorAll("iframe.innli-aanvraag").forEach(function(f){if(f.contentWindow===e.source)f.style.height=Math.max(200,Math.min(5000,e.data.height|0))+"px"})})})();</script>';
        return '<iframe class="innli-aanvraag" src="' . esc_url($src) . '" title="' . esc_attr__('Request availability', 'innli') . '" style="width:100%;height:' . $height . 'px;border:0" loading="lazy"></iframe>' . $resize;
    }

    // ------------------------------------------------------------- Booking attribution

    private static function valid_ref($ref): bool
    {
        return is_string($ref) && preg_match('/^[A-Za-z0-9_-]{8,64}$/', $ref) === 1;
    }

    /** Remember the INNLI reference when a guest arrives via an agent-prepared link. */
    public static function capture_ref(): void
    {
        if (empty($_GET['innli_ref'])) {
            return;
        }
        $ref = sanitize_text_field(wp_unslash($_GET['innli_ref']));
        if (self::valid_ref($ref) && !headers_sent()) {
            setcookie(INNLI_REF_COOKIE, $ref, [
                'expires' => time() + 30 * DAY_IN_SECONDS,
                'path' => COOKIEPATH ?: '/',
                'secure' => is_ssl(),
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
            $_COOKIE[INNLI_REF_COOKIE] = $ref;
        }
    }

    /**
     * Place [innli_conversion] on the booking confirmation page. It reports the
     * booking to INNLI only when the guest arrived via an agent link.
     */
    public static function shortcode_conversion(): string
    {
        $s = self::settings();
        $param = $s['booking_ref_param'];
        $booking = $param && isset($_GET[$param]) ? sanitize_text_field(wp_unslash($_GET[$param])) : '';
        $amount = $s['amount_param'] && isset($_GET[$s['amount_param']]) ? (float) $_GET[$s['amount_param']] : null;
        if ($booking !== '') {
            self::report_booking($booking, $amount);
        }
        return '';
    }

    public static function report_booking($booking_reference, $amount = null): bool
    {
        $s = self::settings();
        $ref = isset($_COOKIE[INNLI_REF_COOKIE]) ? sanitize_text_field(wp_unslash($_COOKIE[INNLI_REF_COOKIE])) : '';
        $booking_reference = substr(sanitize_text_field((string) $booking_reference), 0, 100);
        if (!self::valid_ref($ref) || $booking_reference === '' || !$s['webhook_secret'] || !self::configured()) {
            return false;
        }
        $done_key = 'innli_conv_' . md5($booking_reference);
        if (get_transient($done_key)) {
            return true;
        }
        $payload = ['propertyId' => $s['property_id'], 'ref' => $ref, 'bookingReference' => $booking_reference];
        if ($amount !== null && is_numeric($amount) && $amount >= 0) {
            $payload['amount'] = round((float) $amount, 2);
        }
        $body = wp_json_encode($payload);
        $res = wp_remote_post(trailingslashit($s['api_url']) . 'api/conversions', [
            'timeout' => 5,
            'headers' => [
                'content-type' => 'application/json',
                'x-innli-signature' => hash_hmac('sha256', $body, $s['webhook_secret']),
            ],
            'body' => $body,
        ]);
        $ok = !is_wp_error($res) && wp_remote_retrieve_response_code($res) === 200;
        if ($ok) {
            set_transient($done_key, 1, 30 * DAY_IN_SECONDS);
            if (!headers_sent()) {
                setcookie(INNLI_REF_COOKIE, '', time() - 3600, COOKIEPATH ?: '/');
            }
        }
        return $ok;
    }

    // ------------------------------------------------------------- Crawlers

    /**
     * Explicit groups for AI crawlers. Search access and training access are
     * separate choices. Only applies when WordPress serves a virtual robots.txt.
     */
    public static function robots_txt($output, $public)
    {
        if (!$public) {
            return $output;
        }
        $s = self::settings();
        $extra = "\n# INNLI\n";
        if ($s['allow_search_bots']) {
            foreach (self::SEARCH_BOTS as $bot) {
                $extra .= "User-agent: {$bot}\nAllow: /\n\n";
            }
        }
        if ($s['block_training_bots']) {
            foreach (self::TRAINING_BOTS as $bot) {
                $extra .= "User-agent: {$bot}\nDisallow: /\n\n";
            }
        }
        return rtrim($output) . "\n" . $extra;
    }

    /** Counts AI crawler visits per day. These are never counted as guests. */
    public static function count_crawler(): void
    {
        $ua = isset($_SERVER['HTTP_USER_AGENT']) ? (string) $_SERVER['HTTP_USER_AGENT'] : '';
        if ($ua === '') {
            return;
        }
        foreach (array_merge(self::SEARCH_BOTS, self::TRAINING_BOTS) as $bot) {
            if (stripos($ua, $bot) !== false) {
                $visits = get_option(self::CRAWLER_OPTION, []);
                $day = gmdate('Y-m-d');
                $visits[$day][$bot] = ($visits[$day][$bot] ?? 0) + 1;
                $visits = array_slice($visits, -30, null, true);
                update_option(self::CRAWLER_OPTION, $visits, false);
                return;
            }
        }
    }

    // ------------------------------------------------------------- Admin

    /** "Settings" next to Deactivate on the Plugins page. */
    public static function action_links(array $links): array
    {
        array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=innli')) . '">' . esc_html__('Settings', 'innli') . '</a>');
        return $links;
    }

    /** Until the plugin is connected, say so on the dashboard and plugins page. */
    public static function setup_notice(): void
    {
        $screen = function_exists('get_current_screen') ? get_current_screen() : null;
        if (self::configured() || !current_user_can('manage_options') || !$screen || !in_array($screen->id, ['dashboard', 'plugins'], true)) {
            return;
        }
        echo '<div class="notice notice-info"><p>' . wp_kses_post(sprintf(
            __('INNLI is almost ready: <a href="%s">fill in the address of your INNLI installation and your property ID</a>.', 'innli'),
            esc_url(admin_url('options-general.php?page=innli'))
        )) . '</p></div>';
    }

    public static function admin_menu(): void
    {
        add_options_page('INNLI', 'INNLI', 'manage_options', 'innli', [__CLASS__, 'render_admin']);
    }

    public static function register_settings(): void
    {
        register_setting('innli', self::OPTION, ['sanitize_callback' => [__CLASS__, 'sanitize']]);
    }

    public static function sanitize($input): array
    {
        $d = self::defaults();
        $input = is_array($input) ? $input : [];
        // Just the base address: "https://innli.example.nl/dashboard/" becomes "https://innli.example.nl".
        $api = trim((string) ($input['api_url'] ?? $d['api_url']));
        if ($api !== '' && !preg_match('#^https?://#i', $api)) {
            $api = 'https://' . $api;
        }
        $api = preg_replace('#/(dashboard|mcp|verblijf|stay)(/.*)?$#i', '', untrailingslashit(esc_url_raw($api)));
        $out = [
            'api_url' => $api,
            'property_id' => preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($input['property_id'] ?? '')),
            'webhook_secret' => sanitize_text_field($input['webhook_secret'] ?? ''),
            'output_jsonld' => empty($input['output_jsonld']) ? 0 : 1,
            'allow_search_bots' => empty($input['allow_search_bots']) ? 0 : 1,
            'block_training_bots' => empty($input['block_training_bots']) ? 0 : 1,
            'booking_ref_param' => sanitize_key($input['booking_ref_param'] ?? $d['booking_ref_param']),
            'amount_param' => sanitize_key($input['amount_param'] ?? ''),
        ];
        self::flush_cache();
        return $out;
    }

    public static function render_admin(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        $s = self::settings();
        // Always test the connection live here, not from the cache.
        self::flush_cache();
        $passport = self::configured() ? self::api_get('passport') : null;
        $physical_robots = file_exists(ABSPATH . 'robots.txt');
        $visits = get_option(self::CRAWLER_OPTION, []);
        $totals = [];
        foreach ($visits as $day) {
            foreach ($day as $bot => $n) {
                $totals[$bot] = ($totals[$bot] ?? 0) + $n;
            }
        }
        $name = self::OPTION;
        ?>
        <div class="wrap">
            <h1>INNLI</h1>
            <?php if (!self::configured()) : ?>
                <div class="notice notice-info inline"><p><?php esc_html_e('Two steps to connect: fill in the address where your INNLI runs (for example https://innli.your-bnb.com, the same address as your INNLI dashboard without /dashboard) and your property ID. You find both in the INNLI dashboard under "Booking & details".', 'innli'); ?></p></div>
            <?php elseif (is_array($passport)) : ?>
                <div class="notice notice-success inline"><p>
                    <?php printf(esc_html__('Connected to %1$s. Passport %2$d%% confirmed.', 'innli'), '<strong>' . esc_html($passport['name']) . '</strong>', (int) $passport['completeness']); ?>
                </p></div>
                <?php if (!$s['webhook_secret']) : ?>
                    <div class="notice notice-warning inline"><p><?php esc_html_e('Fill in the secret key for bookings too, otherwise bookings made through AI agents are not reported back.', 'innli'); ?></p></div>
                <?php endif; ?>
            <?php else : ?>
                <div class="notice notice-error inline"><p>
                    <?php esc_html_e('No connection to INNLI.', 'innli'); ?>
                    <?php if (self::$last_error !== '') : ?><br><?php echo esc_html(self::$last_error); ?><?php endif; ?>
                    <br><?php esc_html_e('Check the address (open it in your browser: it should show INNLI) and that your INNLI is reachable from the internet.', 'innli'); ?>
                </p></div>
            <?php endif; ?>
            <?php if ($physical_robots) : ?>
                <div class="notice notice-warning inline"><p><?php esc_html_e('There is a robots.txt file in your WordPress folder. WordPress then does not use the crawler settings below; edit that file yourself.', 'innli'); ?></p></div>
            <?php endif; ?>

            <form method="post" action="options.php">
                <?php settings_fields('innli'); ?>
                <h2><?php esc_html_e('Connection', 'innli'); ?></h2>
                <table class="form-table" role="presentation">
                    <tr><th><label for="innli_api"><?php esc_html_e('INNLI address', 'innli'); ?></label></th>
                        <td><input id="innli_api" type="url" class="regular-text" placeholder="https://innli.your-bnb.com" name="<?php echo esc_attr($name); ?>[api_url]" value="<?php echo esc_attr($s['api_url']); ?>">
                        <p class="description"><?php esc_html_e('The address of your own INNLI installation.', 'innli'); ?></p></td></tr>
                    <tr><th><label for="innli_pid"><?php esc_html_e('Property ID', 'innli'); ?></label></th>
                        <td><input id="innli_pid" class="regular-text" placeholder="prop_…" name="<?php echo esc_attr($name); ?>[property_id]" value="<?php echo esc_attr($s['property_id']); ?>"></td></tr>
                    <tr><th><label for="innli_secret"><?php esc_html_e('Secret key for bookings', 'innli'); ?></label></th>
                        <td><input id="innli_secret" type="password" autocomplete="off" class="regular-text" name="<?php echo esc_attr($name); ?>[webhook_secret]" value="<?php echo esc_attr($s['webhook_secret']); ?>">
                        <p class="description"><?php esc_html_e('Found in the INNLI dashboard under "Booking & details".', 'innli'); ?></p></td></tr>
                </table>

                <h2><?php esc_html_e('Data on your website', 'innli'); ?></h2>
                <table class="form-table" role="presentation">
                    <tr><th><?php esc_html_e('Structured data', 'innli'); ?></th>
                        <td><label><input type="checkbox" name="<?php echo esc_attr($name); ?>[output_jsonld]" value="1" <?php checked($s['output_jsonld']); ?>> <?php esc_html_e('Add schema.org data to the home page (confirmed facts only)', 'innli'); ?></label>
                        <p class="description"><?php esc_html_e('Put [innli_facts] on a visible page, so visitors see the same facts as search engines. Per room: [innli_facts unit="room-id"].', 'innli'); ?></p></td></tr>
                </table>

                <h2><?php esc_html_e('AI crawlers', 'innli'); ?></h2>
                <table class="form-table" role="presentation">
                    <tr><th><?php esc_html_e('Search', 'innli'); ?></th>
                        <td><label><input type="checkbox" name="<?php echo esc_attr($name); ?>[allow_search_bots]" value="1" <?php checked($s['allow_search_bots']); ?>> <?php echo esc_html(sprintf(__('Explicitly allow AI search crawlers (%s)', 'innli'), implode(', ', self::SEARCH_BOTS))); ?></label></td></tr>
                    <tr><th><?php esc_html_e('Model training', 'innli'); ?></th>
                        <td><label><input type="checkbox" name="<?php echo esc_attr($name); ?>[block_training_bots]" value="1" <?php checked($s['block_training_bots']); ?>> <?php echo esc_html(sprintf(__('Block training crawlers (%s)', 'innli'), implode(', ', self::TRAINING_BOTS))); ?></label>
                        <p class="description"><?php esc_html_e('Does not affect your findability in ChatGPT, Claude or Google Search.', 'innli'); ?></p></td></tr>
                </table>

                <h2><?php esc_html_e('Reporting bookings back', 'innli'); ?></h2>
                <table class="form-table" role="presentation">
                    <tr><th><label for="innli_param"><?php esc_html_e('URL parameter with booking number', 'innli'); ?></label></th>
                        <td><input id="innli_param" name="<?php echo esc_attr($name); ?>[booking_ref_param]" value="<?php echo esc_attr($s['booking_ref_param']); ?>">
                        <p class="description"><?php esc_html_e('Put [innli_conversion] on your confirmation page. Only bookings by guests who came through an AI agent are reported; no personal data is sent.', 'innli'); ?></p></td></tr>
                    <tr><th><label for="innli_amount"><?php esc_html_e('URL parameter with amount (optional)', 'innli'); ?></label></th>
                        <td><input id="innli_amount" name="<?php echo esc_attr($name); ?>[amount_param]" value="<?php echo esc_attr($s['amount_param']); ?>"></td></tr>
                </table>
                <?php submit_button(); ?>
            </form>

            <h2><?php esc_html_e('AI crawler visits (30 days)', 'innli'); ?></h2>
            <p class="description"><?php esc_html_e('A crawler visit is not a guest and does not count as a request or booking.', 'innli'); ?></p>
            <?php if ($totals) : ?>
                <table class="widefat striped" style="max-width:480px"><thead><tr><th><?php esc_html_e('Crawler', 'innli'); ?></th><th><?php esc_html_e('Visits', 'innli'); ?></th></tr></thead><tbody>
                <?php foreach ($totals as $bot => $n) : ?>
                    <tr><td><?php echo esc_html($bot); ?></td><td><?php echo (int) $n; ?></td></tr>
                <?php endforeach; ?>
                </tbody></table>
            <?php else : ?>
                <p><?php esc_html_e('No visits counted yet.', 'innli'); ?></p>
            <?php endif; ?>
        </div>
        <?php
    }
}

Innli_Plugin::init();
