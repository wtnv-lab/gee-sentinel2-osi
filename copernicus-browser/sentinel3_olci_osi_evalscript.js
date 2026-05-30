//VERSION=3
// =====================================================
// Sentinel-3 OLCI Oil Spill Index visual screening
// Sentinel-3 OLCI 用 Oil Spill Index 簡易可視化
//
// Copernicus Browser / Sentinel Hub evalscript
// Copernicus Browser / Sentinel Hub 用 evalscript
//
// Important:
// This is a visual screening aid only. It does not confirm oil pollution.
// It is not equivalent to the Sentinel-2 / Google Earth Engine workflow:
// this script uses a single-pixel OSI threshold, not local-mean OSI anomaly.
// For stricter screening, combine this view with Sentinel-3 OLCI QUALITY_FLAGS
// such as land, coastline, bright, invalid, sun_glint_risk, and dubious.
// 重要:
// これは目視スクリーニング用の補助表示であり、油汚染を確定するものではありません。
// Sentinel-2 / Google Earth Engine 版と同等ではありません。
// このスクリプトは局所平均 OSI anomaly ではなく、単一ピクセルの OSI しきい値を使います。
// より厳密に確認する場合は、land、coastline、bright、invalid、
// sun_glint_risk、dubious などの Sentinel-3 OLCI QUALITY_FLAGS と併用してください。
// =====================================================


// -----------------------------------------------------
// User-adjustable parameters
// ユーザー調整用パラメータ
// -----------------------------------------------------

// OSI threshold for yellow overlay.
// 黄色で強調する OSI のしきい値。
var osiThreshold = 2.0;

// NDWI water mask threshold.
// NDWI による水域マスクのしきい値。
var ndwiThreshold = 0.0;

// Extra NIR limit for suppressing bright land and shoreline pixels.
// 明るい陸地・海岸線ピクセルを抑制するための NIR 上限。
var nirWaterMax = 0.12;

// OSI range used for the optional heat-color ramp.
// 任意のヒートカラー表示に使う OSI の範囲。
var osiMin = 1.2;
var osiMax = 3.0;

// Natural-color level adjustment.
// 自然色表示のレベル調整。
var trueColorMin = 0.0;
var trueColorMax = 0.18;
var trueColorGamma = 0.9;

// Yellow overlay opacity for OSI-positive pixels.
// OSI 陽性ピクセルに重ねる黄色の不透明度。
var oilOpacity = 0.85;

// Set to true to display only the OSI heat-color ramp.
// true にすると OSI のヒートカラーだけを表示します。
var showOsiHeatmapOnly = false;


// -----------------------------------------------------
// Band mapping
// バンド対応
//
// Sentinel-3 OLCI:
//   B04 = 490 nm, approximately blue
//   B06 = 560 nm, approximately green
//   B08 = 665 nm, approximately red
//   B17 = 865 nm, near infrared for water masking
//
// OSI = (green + red) / blue
// OSI = (緑 + 赤) / 青
//
// NDWI = (green - NIR) / (green + NIR)
// NDWI = (緑 - 近赤外) / (緑 + 近赤外)
// -----------------------------------------------------

function setup() {
  return {
    input: [{
      bands: ['B04', 'B06', 'B08', 'B17', 'dataMask'],
      units: ['REFLECTANCE', 'REFLECTANCE', 'REFLECTANCE', 'REFLECTANCE', 'DN']
    }],
    output: {
      bands: 4,
      sampleType: 'AUTO'
    }
  };
}

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function stretch(value) {
  var normalized = (value - trueColorMin) / (trueColorMax - trueColorMin);
  return Math.pow(clamp(normalized, 0.0, 1.0), 1.0 / trueColorGamma);
}

function blend(baseRgb, overlayRgb, opacity) {
  return [
    baseRgb[0] * (1.0 - opacity) + overlayRgb[0] * opacity,
    baseRgb[1] * (1.0 - opacity) + overlayRgb[1] * opacity,
    baseRgb[2] * (1.0 - opacity) + overlayRgb[2] * opacity
  ];
}

function osiColor(osi) {
  var t = clamp((osi - osiMin) / (osiMax - osiMin), 0.0, 1.0);

  // Dark blue -> cyan -> yellow -> red.
  // 濃紺 -> シアン -> 黄色 -> 赤。
  if (t < 0.33) {
    var a = t / 0.33;
    return [0.02, 0.08 + 0.55 * a, 0.35 + 0.55 * a];
  }

  if (t < 0.66) {
    var b = (t - 0.33) / 0.33;
    return [0.05 + 0.95 * b, 0.65 + 0.35 * b, 0.90 * (1.0 - b)];
  }

  var c = (t - 0.66) / 0.34;
  return [1.0, 1.0 - 0.8 * c, 0.0];
}

function evaluatePixel(sample) {
  if (sample.dataMask === 0 || sample.B04 <= 0.0) {
    return [0, 0, 0, 0];
  }

  var blue = sample.B04;
  var green = sample.B06;
  var red = sample.B08;
  var nir = sample.B17;
  var osi = (green + red) / blue;
  var ndwi = (green - nir) / (green + nir);
  var water = ndwi > ndwiThreshold && nir < nirWaterMax;

  var trueColor = [
    stretch(red),
    stretch(green),
    stretch(blue)
  ];

  if (showOsiHeatmapOnly) {
    var heat = osiColor(osi);
    return [heat[0], heat[1], heat[2], sample.dataMask];
  }

  if (water && osi >= osiThreshold) {
    var highlighted = blend(trueColor, [1.0, 1.0, 0.0], oilOpacity);
    return [highlighted[0], highlighted[1], highlighted[2], sample.dataMask];
  }

  return [trueColor[0], trueColor[1], trueColor[2], sample.dataMask];
}
