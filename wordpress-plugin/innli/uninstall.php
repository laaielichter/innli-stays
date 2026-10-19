<?php
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}
delete_option('innli_settings');
delete_option('innli_crawler_visits');
