import test from 'node:test';
import assert from 'node:assert/strict';
import {csv,SURVEY_FIELDS} from '../web/results.js';
import {RU} from '../web/content/ru.js';
import {parseCSV} from './csv-helper.mjs';
test('CSV round trips UTF-8, commas, quotes, embedded newlines and structured technical values',()=>{
  const row={text:'Анна, «эксперт»\n"цитата"',technical:[{event:'playing',note:'a,b\r\nc'}],value:600.25};
  const file=csv([row]),[parsed]=parseCSV(file);assert.equal(file.charCodeAt(0),0xFEFF);assert.equal(parsed.text,row.text);assert.deepEqual(JSON.parse(parsed.technical),row.technical);assert.equal(Number(parsed.value),row.value);
});
test('Editable survey resource contains exactly the agreed three independent variables in order',()=>{
  assert.deepEqual(RU.finalSurvey.questions.map(q=>q.key),SURVEY_FIELDS);assert.equal(RU.finalSurvey.questions.length,3);assert.equal(RU.finalSurvey.questions[1].left,'Очень трудно');assert.equal(RU.finalSurvey.questions[2].right,'Постоянно учитывал(а)');
});
