'use strict';

/**
 * PmheeAether Human Check Image Board Auto-Solver Module
 * Handles prompt parsing, catalog resolution, and multi-scale template matching
 * for coordinate-based captcha boards.
 * Universal Module Definition (UMD) for Node.js and Browser environments.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ImageBoardSolver = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {

  function normalizePrompt(prompt) {
    if (typeof prompt !== 'string') return '';
    return prompt
      .trim()
      .toLowerCase()
      .replace(/^(?:กรุณา)?\s*(?:คลิก|กด|เลือก)\s*(?:ที่)?\s*(?:รูปภาพ|รูป|ภาพ)?\s*(?:ของ)?\s*/i, '')
      .replace(/^(?:please\s+)?(?:press|click|select|choose)\s+(?:the\s+)?(?:picture|image|icon)\s+(?:of\s+)?/i, '')
      .replace(/\s*(?:ภายในเวลา|ด่วน|ก่อนหมดเวลา).*$/i, '')
      .trim();
  }

  function resolveTargetItem(prompt, catalog) {
    if (!catalog || !Array.isArray(catalog.items)) return null;
    const target = normalizePrompt(prompt);
    if (!target) return null;

    const item = catalog.items.find(it => it && typeof it.name === 'string' && it.name.trim().toLowerCase() === target);
    if (!item) return null;

    const manifest = catalog.manifest?.items || catalog.manifest || {};
    const iconRaw = manifest[String(item.id)] || manifest[item.id] || '';
    const cleanPath = typeof iconRaw === 'string'
      ? iconRaw.replace(/^https?:\/\/[^/]+/, '').replace(/^\/?art\/icons\//, '').replace(/^\//, '').split('?')[0]
      : '';

    return {
      id: item.id,
      name: item.name,
      iconPath: cleanPath,
      iconUrl: cleanPath ? '/art/icons/' + cleanPath : ''
    };
  }

  /**
   * Match a template image on a board image using alpha-masked Normalized Mean Absolute Error.
   * @param {Object} boardData - { width, height, data: Uint8ClampedArray | Buffer }
   * @param {Object} templateData - { width, height, data: Uint8ClampedArray | Buffer }
   * @param {Object} [options] - search options (step, subsample)
   */
  function matchTemplateOnBoard(boardData, templateData, options = {}) {
    const bw = boardData.width;
    const bh = boardData.height;
    const tw = templateData.width;
    const th = templateData.height;
    const bp = boardData.data;
    const tp = templateData.data;

    if (bw < tw || bh < th) return null;

    const subsample = Math.max(1, options.subsample || 2);
    const alphaThreshold = options.alphaThreshold || 120;

    // Extract non-transparent pixels from template: [relX, relY, R, G, B]
    const mask = [];
    for (let y = 0; y < th; y += subsample) {
      for (let x = 0; x < tw; x += subsample) {
        const idx = (y * tw + x) * 4;
        if (tp[idx + 3] > alphaThreshold) {
          mask.push(x, y, tp[idx], tp[idx + 1], tp[idx + 2]);
        }
      }
    }

    const maskCount = mask.length / 5;
    if (maskCount < 8) return null;

    let bestScore = Infinity;
    let bestX = 0;
    let bestY = 0;

    // Coarse scan
    const coarseStep = Math.max(2, options.coarseStep || 4);
    const maxY = bh - th;
    const maxX = bw - tw;

    for (let by = 0; by <= maxY; by += coarseStep) {
      for (let bx = 0; bx <= maxX; bx += coarseStep) {
        let diffSum = 0;
        for (let m = 0; m < mask.length; m += 5) {
          const mx = mask[m];
          const my = mask[m + 1];
          const bIdx = ((by + my) * bw + (bx + mx)) * 4;
          diffSum += Math.abs(bp[bIdx] - mask[m + 2])
                   + Math.abs(bp[bIdx + 1] - mask[m + 3])
                   + Math.abs(bp[bIdx + 2] - mask[m + 4]);
        }
        const mae = diffSum / maskCount;
        if (mae < bestScore) {
          bestScore = mae;
          bestX = bx;
          bestY = by;
        }
      }
    }

    // Fine scan: step 1 around coarse best
    let fineBestScore = bestScore;
    let fineBestX = bestX;
    let fineBestY = bestY;
    const startY = Math.max(0, bestY - coarseStep);
    const endY = Math.min(maxY, bestY + coarseStep);
    const startX = Math.max(0, bestX - coarseStep);
    const endX = Math.min(maxX, bestX + coarseStep);

    for (let by = startY; by <= endY; by++) {
      for (let bx = startX; bx <= endX; bx++) {
        let diffSum = 0;
        for (let m = 0; m < mask.length; m += 5) {
          const mx = mask[m];
          const my = mask[m + 1];
          const bIdx = ((by + my) * bw + (bx + mx)) * 4;
          diffSum += Math.abs(bp[bIdx] - mask[m + 2])
                   + Math.abs(bp[bIdx + 1] - mask[m + 3])
                   + Math.abs(bp[bIdx + 2] - mask[m + 4]);
        }
        const mae = diffSum / maskCount;
        if (mae < fineBestScore) {
          fineBestScore = mae;
          fineBestX = bx;
          fineBestY = by;
        }
      }
    }

    // Score calibration: MAE of 0 => 100% confidence, MAE > 150 => 0% confidence
    const confidence = Math.max(0, Math.min(100, Math.round(100 - (fineBestScore / 2.5))));

    return {
      bestX: fineBestX,
      bestY: fineBestY,
      centerX: Math.round(fineBestX + tw / 2),
      centerY: Math.round(fineBestY + th / 2),
      width: tw,
      height: th,
      score: fineBestScore,
      confidence
    };
  }

  return {
    normalizePrompt,
    resolveTargetItem,
    matchTemplateOnBoard
  };
});
