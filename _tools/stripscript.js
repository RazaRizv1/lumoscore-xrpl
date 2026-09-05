// Remove a <script id="..."> block from an HTML string, by index rather than by regex.
//
// WHY THIS EXISTS. Stripping a script block with
//
//     new RegExp('<script id="' + id + '">[\\s\\S]*?<\\/script>', 'g')
//
// is correct and works at any size -- measured on a 299,692-byte block. What it is NOT is robust to
// how the transform gets written. This project has had backslashes eaten repeatedly on the way into
// a file, and it happened again here: a transform authored through a shell heredoc turned
// `[\\s\\S]` into `[\s\S]`, which inside a single-quoted JS string is the character class [sS] --
// "one or more s or S". The regex then matched nothing, the transform cheerfully reported that it
// had stripped 0 blocks, and a 293 KB Stellar data layer stayed on the page.
//
// (I first blamed a V8 backtracking limit on large inputs. That was wrong: the same pattern written
// correctly matches the same 300 KB block, and the mangled one fails on a 500-byte one. Size had
// nothing to do with it.)
//
// indexOf has no escape sequences to lose, so this class of failure cannot happen. That is the whole
// argument for it -- not speed, not size.
'use strict';

const OPEN_A = '<' + 'script id="';
const CLOSE = '<' + '/' + 'script>';

// Returns { html, removed } -- removed is how many blocks were taken out.
function stripById(html, id) {
  const open = OPEN_A + id + '">';
  let removed = 0;
  for (;;) {
    const i = html.indexOf(open);
    if (i < 0) break;
    const j = html.indexOf(CLOSE, i + open.length);
    if (j < 0) {
      // An unterminated block: refuse rather than truncate the rest of the document.
      throw new Error('script id="' + id + '" has no closing tag');
    }
    html = html.slice(0, i) + html.slice(j + CLOSE.length);
    removed++;
  }
  return { html, removed };
}

module.exports = { stripById };
