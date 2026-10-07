'use strict';

const fs = require('fs');
const path = require('path');

// character/bubble-*.json — 픽셀 말풍선 (마름모 아트보드 포맷)
// 캐릭터 스티커(PNG)는 렌더러가 직접 읽으므로 여기서는 말풍선만 건넨다
function loadAnims(characterDir) {
  const out = {};
  try {
    for (const f of fs.readdirSync(characterDir)) {
      if (!f.endsWith('.json')) continue;
      const base = path.basename(f, '.json').normalize('NFC');
      if (!base.startsWith('bubble-')) continue;
      try {
        out[base] = JSON.parse(fs.readFileSync(path.join(characterDir, f), 'utf8'));
      } catch (e) {
        console.error('[anims] 파싱 실패:', f, e.message);
      }
    }
  } catch (e) {
    console.error('[anims] 읽기 실패:', e.message);
  }
  return out;
}

module.exports = { loadAnims };
