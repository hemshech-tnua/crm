// The template helpers page authors use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, esc, attrs, inline, safeUrl, keepNames } from '../lib/html.mjs';

test('html`` escapes values and keeps nested html', () => {
  const user = '<img src=x onerror=alert(1)>"\'&';
  assert.equal(String(html`<p title="${user}">${user}</p>`), '<p title="&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;">&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</p>');
  assert.equal(String(html`<ul>${['a', 'b'].map((x) => html`<li>${x}</li>`)}</ul>`), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(String(html`${null}${undefined}${false}${true}${0}`), '0');
  assert.equal(String(html`${raw('<b>ok</b>')}`), '<b>ok</b>');
  assert.equal(esc('a<b'), 'a&lt;b');
});

test('attrs, safeUrl, inline markup, keepNames', () => {
  assert.equal(String(attrs({ class: 'a', hidden: true, x: null, y: false, 'data-n': 3 })), ' class="a" hidden data-n="3"');
  assert.throws(() => attrs({ 'on click': 1 }));
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl('https://a.b/c'), 'https://a.b/c');
  assert.equal(safeUrl('/crm/site/'), '/crm/site/');
  assert.equal(String(inline('**חזק** ו[קישור](https://x.y) <b>')), '<strong>חזק</strong> ו<a href="https://x.y">קישור</a> &lt;b&gt;');
  assert.doesNotMatch(String(inline('[x](javascript:alert(1))')), /javascript:/);
  assert.equal(String(inline('[x](javascript:void)')), '<a href="#">x</a>');
  assert.equal(keepNames('ברוכים הבאים להמשך תנועה'), 'ברוכים הבאים להמשך תנועה');
});
