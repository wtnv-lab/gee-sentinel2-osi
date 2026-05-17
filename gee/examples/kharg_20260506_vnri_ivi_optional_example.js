// =====================================================
// Kharg Island VNRI/IVI optional example: Sentinel-2 oil slick candidate extraction
// Kharg Island VNRI/IVI 任意実装例: Sentinel-2 による海面油膜候補の抽出
//
// Google Earth Engine Code Editor script
// Google Earth Engine Code Editor 用スクリプト
//
// Prepared as part of the joint research project
// "Updating Reporting Methods with Advanced Technologies"
// between Hidenori Watanave Laboratory at the
// University of Tokyo Graduate School and Nippon TV.
// 東京大学大学院 渡邉英徳研究室と日本テレビとの共同研究
// 「先端技術を活用した報道手法のアップデート」の一環として整備。
//
// This optional example extracts candidate optical anomalies using
// VNRI and IVI anomaly screening based on D'Ugo et al. (2025).
// It does not confirm oil pollution.
// このスクリプトは、海面油膜の光学的特徴と整合する可能性のある
// 候補異常を VNRI / IVI anomaly により抽出する任意実装例です。
// 油汚染を確定するものではありません。
//
// Recommended validation:
// SAR imagery, AIS/vessel records, wind/current data,
// time-series imagery, and field/reporting information.
// 推奨される検証:
// SAR画像、AIS/船舶情報、風・海流データ、時系列画像、
// 現地情報や報告情報。
//
// References:
// - Rajendran et al. (2021), "Oil Spill Index (OSI) to
//   Sentinel-2 Satellite Data." DOI: 10.29117/quarfe.2021.0020
// - D'Ugo et al. (2025), "A Sentinel-2-Based System to Detect
//   and Monitor Oil Spills: Demonstration on 2024 Tobago Accident."
//   Remote Sensing, 17(2), 230. DOI: 10.3390/rs17020230
//   https://www.mdpi.com/2072-4292/17/2/230
//
// Notes:
// - Uses Sentinel-2 Cloud Probability for cloud false-positive suppression.
// - Cloud Probability により雲由来の偽陽性を抑制します。
// - Sentinel-2 and Cloud Probability are mosaicked separately.
// - Sentinel-2 と Cloud Probability は join せず、別々に mosaic します。
// =====================================================


// -----------------------------------------------------
// 0. User-editable settings
// 0. ユーザーが変更する設定
// -----------------------------------------------------

var siteName = 'Kharg_NTV_Whole';
var analysisDate = '2026-05-06';
var exportFolder = 'GEE_OSI_exports';

var sceneCloudMax = 80;
var cloudProbabilityMax = 85;
var ndwiThreshold = 0.05;
var vnriAnomalyThreshold = 0.05;
var iviAnomalyThreshold = 0.25;
var requireBothIndices = false;
var localMeanRadiusMeters = 500;

var trueColorMin = 0;
var trueColorMax = 0.3;
var trueColorGamma = 1.0;
var trueColorBrightness = 0.85;
var oilOpacity = 1.0;


// -----------------------------------------------------
// 1. Automatic date and filename generation
// 1. 日付・ファイル名の自動生成
// -----------------------------------------------------

function dateStringForFile(dateText) {
  return dateText.replace(/-/g, '');
}

function nextDate(dateText) {
  var d = new Date(dateText + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

var start = analysisDate;

// The end date is exclusive in ee.ImageCollection.filterDate().
// ee.ImageCollection.filterDate() の end は排他的です。
var end = nextDate(analysisDate);

var dateTag = dateStringForFile(analysisDate);
var dateLabel = analysisDate;
var exportPrefix = siteName + '_VNRI_IVI_' + dateTag;
var layerSuffix = siteName + ' - ' + dateLabel;


// -----------------------------------------------------
// 2. AOI: Area of interest
// 2. AOI: 解析対象範囲
//
// Kharg Island focused AOI.
// Kharg Island 周辺の絞り込み AOI。
// -----------------------------------------------------

var aoi = ee.Geometry({
  'type': 'Polygon',
  'coordinates': [[
    [50.183487, 29.166513],
    [50.183487, 29.307058],
    [50.445442, 29.307058],
    [50.445442, 29.166513],
    [50.183487, 29.166513]
  ]]
});


// -----------------------------------------------------
// 3. Load Sentinel-2 image collection
// 3. Sentinel-2 画像コレクション取得
// -----------------------------------------------------

var s2 = ee.ImageCollection('COPERNICUS/S2_HARMONIZED')
  .filterBounds(aoi)
  .filterDate(start, end)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', sceneCloudMax))
  // mosaic() gives priority to later images, so keep lower-cloud scenes last.
  // mosaic() は後ろの画像を優先するため、低雲量シーンが後ろに来るようにします。
  .sort('CLOUDY_PIXEL_PERCENTAGE', false);

print('Number of Sentinel-2 images:', s2.size());
print('Sentinel-2 image collection:', s2);


// -----------------------------------------------------
// 4. Load Sentinel-2 Cloud Probability collection
// 4. Sentinel-2 Cloud Probability コレクション取得
//
// Do not join by system:index. Mosaic separately for stability.
// system:index で join せず、安定性のため別々に mosaic します。
// -----------------------------------------------------

var s2Clouds = ee.ImageCollection('COPERNICUS/S2_CLOUD_PROBABILITY')
  .filterBounds(aoi)
  .filterDate(start, end)
  .sort('system:time_start');

print('Number of Cloud Probability images:', s2Clouds.size());
print('Cloud Probability collection:', s2Clouds);


// -----------------------------------------------------
// 5. Print image metadata
// 5. 画像メタデータの表示
// -----------------------------------------------------

var imageInfo = s2.map(function(image) {
  return ee.Feature(null, {
    id: image.id(),
    date: image.date().format('YYYY-MM-dd HH:mm:ss'),
    cloud: image.get('CLOUDY_PIXEL_PERCENTAGE'),
    tile: image.get('MGRS_TILE')
  });
});

print('Sentinel-2 image dates and tiles:', imageInfo);

var cloudInfo = s2Clouds.map(function(image) {
  return ee.Feature(null, {
    id: image.id(),
    date: image.date().format('YYYY-MM-dd HH:mm:ss'),
    tile: image.get('MGRS_TILE')
  });
});

print('Cloud Probability dates and tiles:', cloudInfo);


// -----------------------------------------------------
// 6. Sentinel-2 mosaic
// 6. Sentinel-2 モザイク
// -----------------------------------------------------

var s2Bands = ['B2', 'B3', 'B4', 'B6', 'B7', 'B8'];
var imgRaw = s2
  .select(s2Bands)
  .mosaic()
  .clip(aoi);

print('Mosaic image:', imgRaw);
print('Mosaic band names:', imgRaw.bandNames());

// Scale Sentinel-2 integer values to reflectance.
// Sentinel-2 の整数値を反射率へ変換します。
var img = imgRaw.divide(10000);


// -----------------------------------------------------
// 7. Cloud Probability mosaic
// 7. Cloud Probability モザイク
// -----------------------------------------------------

var cloudProbability = s2Clouds
  .select('probability')
  .mosaic()
  .clip(aoi)
  .rename('cloud_probability');

print('Cloud Probability mosaic:', cloudProbability);

var cloudClear = cloudProbability
  .lt(cloudProbabilityMax)
  .rename('cloud_probability_clear_mask');

var cloudRejected = cloudProbability
  .gte(cloudProbabilityMax)
  .rename('cloud_probability_rejected_mask');


// -----------------------------------------------------
// 8. Band definitions
// 8. バンド定義
//
// -----------------------------------------------------

var B2 = img.select('B2');   // Blue / 青, 10 m
var B3 = img.select('B3');   // Green / 緑, 10 m
var B4 = img.select('B4');   // Red / 赤, 10 m
var B6 = img.select('B6');   // Red edge 740 nm / レッドエッジ 740 nm, 20 m
var B7 = img.select('B7');   // Red edge 783 nm / レッドエッジ 783 nm, 20 m
var B8 = img.select('B8');   // NIR / 近赤外, 10 m


// -----------------------------------------------------
// 9. Water mask
// 9. 水域マスク
//
// NDWI = (Green - NIR) / (Green + NIR)
// NDWI = (緑 - 近赤外) / (緑 + 近赤外)
// -----------------------------------------------------

var ndwi = B3.subtract(B8)
  .divide(B3.add(B8))
  .rename('NDWI');

var water = ndwi.gt(ndwiThreshold)
  .rename('water_mask');


// -----------------------------------------------------
// 10. D'Ugo et al. VNRI and IVI indices
// 10. D'Ugo et al. VNRI / IVI 指標
//
// VNRI = - (2 * r560 - r665 - r740) / (r560 + r665 + r740)
// IVI  =   (r740 + r783 + r842) / (r490 + r560 + r665)
//
// Sentinel-2 band mapping:
// r490 = B2, r560 = B3, r665 = B4,
// r740 = B6, r783 = B7, r842 = B8
// Sentinel-2 バンド対応:
// r490 = B2, r560 = B3, r665 = B4,
// r740 = B6, r783 = B7, r842 = B8
//
// These indices are used by this optional example to build the candidate mask.
// Because VNRI and IVI use 20 m red-edge bands, optional exports use 20 m scale.
// この任意実装例では、これらの指標を候補マスク作成に使用します。
// VNRI と IVI は 20 m の red-edge バンドを使うため、任意出力は 20 m scale です。
// -----------------------------------------------------

var vnri = B3.multiply(2)
  .subtract(B4)
  .subtract(B6)
  .divide(B3.add(B4).add(B6))
  .multiply(-1)
  .rename('VNRI');

var ivi = B6.add(B7).add(B8)
  .divide(B2.add(B3).add(B4))
  .rename('IVI');


// -----------------------------------------------------
// 11. VNRI / IVI anomaly
// 11. VNRI / IVI anomaly
//
// Highlight pixels that differ from the local mean VNRI / IVI.
// 周辺の局所平均 VNRI / IVI からの差分を強調します。
// -----------------------------------------------------

function localIndexAnomaly(indexImage, outputName) {
  var waterIndex = indexImage.updateMask(water);

  var localMean = waterIndex.reduceNeighborhood({
    reducer: ee.Reducer.mean(),
    kernel: ee.Kernel.square({
      radius: localMeanRadiusMeters,
      units: 'meters'
    }),
    optimization: 'boxcar'
  });

  return waterIndex.subtract(localMean).rename(outputName);
}

var vnriAnomaly = localIndexAnomaly(vnri, 'VNRI_anomaly');
var iviAnomaly = localIndexAnomaly(ivi, 'IVI_anomaly');


// -----------------------------------------------------
// 12. Oil slick candidate mask
// 12. 油膜候補マスク
//
// Candidate = VNRI / IVI anomaly + water mask + Cloud Probability filter
// 候補 = VNRI / IVI anomaly + 水域マスク + Cloud Probability フィルタ
// -----------------------------------------------------

var vnriCandidate = vnriAnomaly.abs()
  .gt(vnriAnomalyThreshold)
  .rename('vnri_candidate');

var iviCandidate = iviAnomaly.abs()
  .gt(iviAnomalyThreshold)
  .rename('ivi_candidate');

var indexCandidate = requireBothIndices ?
  vnriCandidate.and(iviCandidate) :
  vnriCandidate.or(iviCandidate);

var baseCandidate = indexCandidate
  .and(water)
  .rename('base_oil_candidate');

var candidate = baseCandidate
  .and(cloudClear)
  .rename('oil_candidate');

var candidateByte = candidate.unmask(0).uint8()
  .rename('oil_candidate');

var candidateMask = candidateByte.updateMask(candidateByte);

var rejectedByCloudProbability = baseCandidate
  .and(cloudRejected)
  .rename('candidate_rejected_by_cloud_probability');


// -----------------------------------------------------
// 13. Minimal map visualization
// 13. 最小限の地図表示
// -----------------------------------------------------

Map.centerObject(aoi, 10);

var trueColorRgb = img.select(['B4', 'B3', 'B2']);
var trueColorDisplay = trueColorRgb.multiply(trueColorBrightness);

var trueColorVisParams = {
  min: trueColorMin,
  max: trueColorMax,
  gamma: trueColorGamma
};

Map.addLayer(
  trueColorDisplay,
  trueColorVisParams,
  'True color - ' + layerSuffix
);

Map.addLayer(
  candidateMask,
  {
    palette: ['yellow'],
    opacity: oilOpacity
  },
  'Oil candidate - ' + layerSuffix
);

Map.addLayer(
  cloudProbability,
  {
    min: 0,
    max: 100,
    palette: ['000000', '4444ff', '00ffff', 'ffff00', 'ff0000', 'ffffff']
  },
  'Cloud probability - ' + layerSuffix,
  false
);

Map.addLayer(
  rejectedByCloudProbability.updateMask(rejectedByCloudProbability),
  {
    palette: ['red'],
    opacity: 0.9
  },
  'Rejected by cloud probability - ' + layerSuffix,
  false
);


// -----------------------------------------------------
// 14. Optional diagnostic layers: uncomment if needed
// 14. 追加診断レイヤ: 必要に応じてコメント解除
// -----------------------------------------------------

/*
Map.addLayer(
  ndwi,
  {
    min: -0.5,
    max: 0.8
  },
  'NDWI - ' + layerSuffix,
  false
);
*/

/*
Map.addLayer(
  vnriAnomaly,
  {
    min: -0.1,
    max: 0.1,
    palette: ['003f5c', 'f7f7f7', 'ffa600']
  },
  'VNRI anomaly - ' + layerSuffix,
  false
);
*/

/*
Map.addLayer(
  iviAnomaly,
  {
    min: -0.4,
    max: 0.4,
    palette: ['003f5c', 'f7f7f7', 'ffa600']
  },
  'IVI anomaly - ' + layerSuffix,
  false
);
*/

/*
Map.addLayer(
  vnri.updateMask(water),
  {
    min: -0.5,
    max: 0.5,
    palette: ['003f5c', 'f7f7f7', 'ffa600']
  },
  'VNRI - ' + layerSuffix,
  false
);
*/

/*
Map.addLayer(
  ivi.updateMask(water),
  {
    min: 0.5,
    max: 2.5,
    palette: ['003f5c', 'f7f7f7', 'ffa600']
  },
  'IVI - ' + layerSuffix,
  false
);
*/


// -----------------------------------------------------
// 15. Create images for export
// 15. 出力用画像の作成
// -----------------------------------------------------

var trueColorVis = trueColorDisplay.visualize(trueColorVisParams);

var candidateVis = candidateMask.visualize({
  palette: ['yellow'],
  opacity: oilOpacity
});

var outputVis = trueColorVis.blend(candidateVis);


// -----------------------------------------------------
// 16. Default exports to Google Drive
// 16. Google Drive への標準出力
// -----------------------------------------------------

// True color + yellow VNRI/IVI candidate preview
// True color + 黄色の VNRI/IVI 候補プレビュー
Export.image.toDrive({
  image: outputVis,
  description: exportPrefix + '_TrueColor',
  folder: exportFolder,
  fileNamePrefix: exportPrefix + '_TrueColor',
  region: aoi,
  scale: 10,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});

// Binary 0/1 oil candidate mask
// 0/1 の油膜候補マスク
Export.image.toDrive({
  image: candidateByte,
  description: exportPrefix + '_Mask',
  folder: exportFolder,
  fileNamePrefix: exportPrefix + '_Mask',
  region: aoi,
  scale: 10,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});

// Cloud Probability for checking cloud filtering
// 雲フィルタ確認用の Cloud Probability
Export.image.toDrive({
  image: cloudProbability.uint8(),
  description: exportPrefix + '_CloudProbability',
  folder: exportFolder,
  fileNamePrefix: exportPrefix + '_CloudProbability',
  region: aoi,
  scale: 10,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});

// Natural color only
// Natural Color のみ
Export.image.toDrive({
  image: trueColorVis,
  description: exportPrefix + '_NaturalColor',
  folder: exportFolder,
  fileNamePrefix: exportPrefix + '_NaturalColor',
  region: aoi,
  scale: 10,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});


// -----------------------------------------------------
// 17. Optional exports: uncomment if needed
// 17. 追加出力: 必要に応じてコメント解除
// -----------------------------------------------------

/*
// VNRI anomaly for later threshold testing in QGIS or other GIS tools
// QGIS などで閾値を再検討するための VNRI anomaly
Export.image.toDrive({
  image: vnriAnomaly.float(),
  description: exportPrefix + '_VNRI_Anomaly',
  folder: exportFolder,
  fileNamePrefix: exportPrefix + '_VNRI_Anomaly',
  region: aoi,
  scale: 20,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});
*/

/*
// IVI anomaly for later threshold testing in QGIS or other GIS tools
// QGIS などで閾値を再検討するための IVI anomaly
Export.image.toDrive({
  image: iviAnomaly.float(),
  description: exportPrefix + '_IVI_Anomaly',
  folder: exportFolder,
  fileNamePrefix: exportPrefix + '_IVI_Anomaly',
  region: aoi,
  scale: 20,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});
*/

/*
// NDWI for water-mask validation
// 水域マスク検証用の NDWI
Export.image.toDrive({
  image: ndwi.float(),
  description: exportPrefix + '_NDWI',
  folder: exportFolder,
  fileNamePrefix: exportPrefix + '_NDWI',
  region: aoi,
  scale: 10,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});
*/

/*
// VNRI from D'Ugo et al. (2025)
// D'Ugo et al. (2025) の VNRI
Export.image.toDrive({
  image: vnri.updateMask(water).float(),
  description: exportPrefix + '_VNRI',
  folder: exportFolder,
  fileNamePrefix: exportPrefix + '_VNRI',
  region: aoi,
  scale: 20,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});
*/

/*
// IVI from D'Ugo et al. (2025)
// D'Ugo et al. (2025) の IVI
Export.image.toDrive({
  image: ivi.updateMask(water).float(),
  description: exportPrefix + '_IVI',
  folder: exportFolder,
  fileNamePrefix: exportPrefix + '_IVI',
  region: aoi,
  scale: 20,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});
*/


// -----------------------------------------------------
// 18. Print analysis settings
// 18. 解析条件を Console に表示
// -----------------------------------------------------

print('Export prefix:', exportPrefix);
print('Export folder:', exportFolder);
print('Analysis date:', analysisDate);
print('Start:', start);
print('End:', end);
print('Scene cloud max:', sceneCloudMax);
print('Cloud probability max:', cloudProbabilityMax);
print('NDWI threshold:', ndwiThreshold);
print('VNRI anomaly threshold:', vnriAnomalyThreshold);
print('IVI anomaly threshold:', iviAnomalyThreshold);
print('Require both indices:', requireBothIndices);
print('Local mean radius meters:', localMeanRadiusMeters);
print('True color min:', trueColorMin);
print('True color max:', trueColorMax);
print('True color gamma:', trueColorGamma);
print('True color brightness:', trueColorBrightness);


// -----------------------------------------------------
// 19. Adjustment notes
// 19. 調整用メモ
// -----------------------------------------------------

// If oil candidates are removed too aggressively:
// 油膜候補が消えすぎる場合:
//   cloudProbabilityMax = 90 or 95
//
// If cloud false positives remain:
// 雲由来の偽陽性が残る場合:
//   cloudProbabilityMax = 70 or 75
//
// If too many candidates appear:
// 候補が出すぎる場合:
//   vnriAnomalyThreshold = 0.08 or 0.10
//   iviAnomalyThreshold = 0.35 or 0.45
//   requireBothIndices = true
//
// If too few candidates appear:
// 候補が少なすぎる場合:
//   vnriAnomalyThreshold = 0.03 or 0.02
//   iviAnomalyThreshold = 0.15 or 0.10
//   requireBothIndices = false
//
// To make oil candidates stand out more on the true-color background:
// True color 背景上で油膜候補をより目立たせる場合:
//   trueColorBrightness = 0.75 or 0.8
//   trueColorMax = 0.35 or 0.4
//
// Adjust localMeanRadiusMeters as needed.
// 必要に応じて localMeanRadiusMeters を調整してください。
// Larger values can slow Mask and TrueColor exports.
// 値を大きくすると Mask と TrueColor の出力が遅くなる場合があります。
//
// If the water mask is too strict:
// 水域マスクが厳しすぎる場合:
//   ndwiThreshold = 0.0
