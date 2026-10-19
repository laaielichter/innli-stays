import { randomBytes } from 'node:crypto';
import { track } from '../analytics/funnel.ts';
import { getFactDefinition, ownerSetFact } from '../domain/facts.ts';
import type { HostQuestion, Language, Property } from '../domain/types.ts';
import { currentLang, defaultLang, ownerLang, t } from '../i18n/index.ts';
import type { Store } from '../store.ts';
import type { Mailer } from './mailer.ts';
import { pushToOwner } from './push.ts';
import { AnswerAgent } from './answers.ts';
import { RequestError } from './service.ts';

/**
 * Questions agents ask the host about things the passport does not answer.
 * Answering can confirm the underlying fact, so the next agent no longer has
 * to ask: unknowns turn into verified data through real guest demand.
 */
export class QuestionService {
  private store: Store;
  private mailer: Mailer;
  private publicUrl: string;

  readonly answers: AnswerAgent;

  constructor(store: Store, mailer: Mailer, publicUrl: string) {
    this.answers = new AnswerAgent(store);
    this.store = store;
    this.mailer = mailer;
    this.publicUrl = publicUrl.replace(/\/$/, '');
  }

  async ask(property: Property, input: { question: string; factKey?: string; unitId?: string; replyEmail?: string; language?: Language; kind?: 'question' | 'issue' }, agentClient: string): Promise<HostQuestion> {
    const question = input.question.trim();
    if (question.length < 5) throw new RequestError(t('q.tooShort'));
    if (input.factKey) {
      const def = getFactDefinition(input.factKey);
      if (!def) throw new RequestError(t('q.unknownFact', { key: input.factKey }));
      if (def.scope === 'unit' && !property.units.some((u) => u.id === input.unitId)) throw new RequestError(t('q.needsUnit'));
    }
    const q: HostQuestion = {
      id: `vrg_${randomBytes(5).toString('hex')}`,
      publicToken: randomBytes(16).toString('base64url'),
      propertyId: property.id,
      question: question.slice(0, 1000),
      factKey: input.factKey,
      unitId: input.factKey && getFactDefinition(input.factKey)?.scope === 'unit' ? input.unitId : undefined,
      replyEmail: input.replyEmail,
      language: input.language ?? property.language ?? defaultLang(),
      agentClient,
      status: 'open',
      kind: input.kind === 'issue' ? 'issue' : undefined,
      createdAt: new Date().toISOString(),
    };
    // The answer agent answers right away when the host's confirmed facts or FAQ cover the question.
    // A report about wrong data always goes to the host.
    if (q.kind !== 'issue') {
      // Answer in the asker's language: the guest's, or the agent's (English) when none was given.
      const lang = input.language ?? currentLang();
      const result = this.answers.answer(property, q.factKey ? `${q.question} ${q.factKey.split('.')[0]}` : q.question, { unitId: q.unitId, lang });
      if (result.answered && (property.bookingRules?.autoAnswer ?? true)) {
        q.status = 'answered';
        q.answer = result.answer;
        q.answeredBy = 'assistant';
        q.answeredAt = new Date().toISOString();
        this.store.saveQuestion(q);
        track(this.store, 'host_question', property.id, agentClient, { questionId: q.id, factKey: q.factKey, answeredBy: 'assistant' });
        return q;
      }
      if (result.confidence === 'partial') q.draft = result.answer;
    }
    this.store.saveQuestion(q);
    track(this.store, 'host_question', property.id, agentClient, { questionId: q.id, factKey: q.factKey });
    const o = ownerLang(property);
    const issue = q.kind === 'issue';
    await pushToOwner(property, t(issue ? 'push.issue.title' : 'push.question.title', {}, o), t('push.question.body', { question: q.question }, o));
    if (property.contactEmail) {
      await this.mailer.send({
        to: property.contactEmail,
        subject: t(issue ? 'owner.issue.subject' : 'owner.question.subject', { agent: agentClient }, o),
        text: t('owner.question.body', { agent: agentClient, question: q.question, dashboard: `${this.publicUrl}/dashboard/`, tip: q.factKey ? t('owner.question.tip', {}, o) : '' }, o),
      });
    }
    return q;
  }

  async answer(property: Property, id: string, input: { answer: string; factValue?: unknown; publishAsFaq?: boolean }): Promise<HostQuestion> {
    const q = this.store.getQuestion(id);
    if (!q || q.propertyId !== property.id) throw new RequestError(t('q.notFound'), 404);
    if (q.status === 'answered') throw new RequestError(t('q.alreadyAnswered'), 409);
    const answer = input.answer.trim();
    if (!answer) throw new RequestError(t('q.answerRequired'));
    if (q.factKey && input.factValue !== undefined && input.factValue !== null && input.factValue !== '') {
      const facts = q.unitId ? property.units.find((u) => u.id === q.unitId)?.facts : property.facts;
      if (!facts) throw new RequestError(t('q.unitGone'), 409);
      ownerSetFact(facts, q.factKey, input.factValue);
      this.store.saveProperty(property);
    }
    q.status = 'answered';
    q.answeredBy = 'owner';
    q.answer = answer.slice(0, 2000);
    q.publishAsFaq = input.publishAsFaq === true;
    q.answeredAt = new Date().toISOString();
    this.store.saveQuestion(q);
    if (q.replyEmail) {
      await this.mailer.send({
        to: q.replyEmail,
        replyTo: property.contactEmail,
        subject: t('mail.answer.subject', { property: property.name }, q.language ?? defaultLang()),
        text: t('mail.answer.body', { question: q.question, property: property.name, answer: q.answer, regards: t('mail.regards', {}, q.language ?? defaultLang()) }, q.language ?? defaultLang()),
      });
    }
    return q;
  }
}
