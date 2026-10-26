import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appliquerEvenement, creerLecteurCodex } from '../codex-local.mjs';

const base = Date.parse('2026-10-26T15:00:00Z');
const event = (type, payload, delta = 0) => ({ timestamp: new Date(base + delta).toISOString(), type, payload });
const ligne = e => JSON.stringify(e) + '\n';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-codex-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'sessions', '2026', '10', '26'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rollout.jsonl');
  const meta = event('session_meta', { id: 'test-1', cwd: 'C:/projets/demo', source: 'vscode' });
  const start = event('event_msg', { type: 'task_started' }, 1000);
  const prompt = event('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Corriger la connexion' }] }, 1100);
  fs.writeFileSync(file, [meta, start, prompt].map(ligne).join(''));
  return { root, file, lecteur: creerLecteurCodex({ racines: [path.join(root, 'sessions')] }) };
}

test('Desktop : activité, outil, fin et reprise, même avec une écriture partielle', t => {
  const { file, lecteur } = fixture(t);
  let jobs = lecteur.travaux(base + 2000); assert.equal(jobs[0].statut, 'actif');
  const outil = ligne(event('response_item', { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'node --test' }) }, 3000));
  fs.appendFileSync(file, outil.slice(0, -2));
  assert.equal(lecteur.travaux(base + 4000)[0].commande, null);
  fs.appendFileSync(file, outil.slice(-2));
  jobs = lecteur.travaux(base + 5000); assert.match(jobs[0].commande.commande, /node --test/);
  fs.appendFileSync(file, ligne(event('event_msg', { type: 'task_complete', last_agent_message: 'Corrigé.' }, 6000)));
  jobs = lecteur.travaux(base + 7000); assert.equal(jobs[0].statut, 'termine');
  assert.equal(lecteur.contenu(jobs[0].nom, 'rapport'), 'Corrigé.');
  assert.equal(lecteur.contenu(jobs[0].nom, 'consigne'), 'Corriger la connexion');
  fs.appendFileSync(file, ligne(event('event_msg', { type: 'thread_settings_applied' }, 8000)));
  assert.equal(lecteur.travaux(base + 9000)[0].statut, 'termine');
  fs.appendFileSync(file, ligne(event('event_msg', { type: 'task_started' }, 10000)));
  assert.equal(lecteur.travaux(base + 11000)[0].statut, 'actif');
  assert.equal(lecteur.travaux(base + 16 * 60000)[0].statut, 'silencieux');
});

test('gros fichier : lecture bornée, titres, exclusion des anciens tours malgré un réglage récent', t => {
  const { root, file, lecteur } = fixture(t);
  fs.appendFileSync(file, 'x'.repeat(5 * 1024 * 1024) + '\n');
  fs.appendFileSync(file, ligne(event('response_item', { type: 'custom_tool_call', name: 'exec', input: 'await tools.exec_command({cmd:"node --test"})' }, 2000)));
  fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({ id: 'test-1', thread_name: 'Réparer le projet' }) + '\n');
  const jobs = lecteur.travaux(base + 3000);
  assert.equal(jobs[0].titre, 'Réparer le projet'); assert.equal(jobs[0].statut, 'actif');
  assert.equal(jobs[0].aSession, false); // Aucun bouton d'action Unix sur les sessions natives.
  fs.appendFileSync(file, ligne(event('event_msg', { type: 'thread_settings_applied' }, 72 * 3600000)));
  assert.equal(lecteur.travaux(base + 72 * 3600000).length, 0);
});

test('interruption, réponse finale, contexte système et commandes shell natives', () => {
  const s = {};
  appliquerEvenement(s, event('event_msg', { type: 'task_started' }));
  appliquerEvenement(s, event('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>secret</environment_context>' }] }));
  assert.equal(s.demande, undefined);
  appliquerEvenement(s, event('event_msg', { type: 'turn_aborted' }, 1000)); assert.equal(s.etat, 'interrompu');
  appliquerEvenement(s, event('response_item', { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Terminé' }] }, 2000));
  assert.equal(s.etat, 'termine'); assert.equal(s.rapport, 'Terminé');
  appliquerEvenement(s, event('response_item', { type: 'local_shell_call', action: { command: ['powershell', '-Command', 'Get-Date'] } }, 3000));
  assert.equal(s.etat, 'actif'); assert.match(s.commande.commande, /Get-Date/);
});

test('une conversation déjà suivie par son journal codex-run.sh n\'est pas comptée deux fois', t => {
  const { lecteur } = fixture(t);
  assert.equal(lecteur.travaux(base + 2000).length, 1);
  assert.equal(lecteur.travaux(base + 2000, new Set(['test-1'])).length, 0);
});
