// =====================================================
// Sentinel-2 sea-surface oil slick candidate extraction
// Sentinel-2 による海面油膜候補の抽出
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
// This script extracts candidate optical anomalies that may be
// consistent with sea-surface oil slick signatures. It does not
// confirm oil pollution.
// このスクリプトは、海面油膜の光学的特徴と整合する可能性のある
// 候補異常を抽出します。油汚染を確定するものではありません。
//
// Recommended validation:
// SAR imagery, AIS/vessel records, wind/current data,
// time-series imagery, and field/reporting information.
// 推奨される検証:
// SAR画像、AIS/船舶情報、風・海流データ、時系列画像、
// 現地情報や報告情報。
//
// Reference:
// Rajendran et al. (2021), "Oil Spill Index (OSI) to
// Sentinel-2 Satellite Data." DOI: 10.29117/quarfe.2021.0020
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

var siteName = 'Your_Site_Name';
var analysisDate = '2026-05-06';
var exportFolder = 'GEE_OSI_exports';

var sceneCloudMax = 80;
var cloudProbabilityMax = 85;
var ndwiThreshold = 0.05;
var osiAnomalyThreshold = 0.15;
var localMeanRadiusMeters = 1000;

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
var exportPrefix = siteName + '_OSI_' + dateTag;
var layerSuffix = siteName + ' - ' + dateLabel;


// -----------------------------------------------------
// 2. AOI: Area of interest
// 2. AOI: 解析対象範囲
//
// Replace this polygon with your own AOI.
// This placeholder AOI is only for keeping the script syntactically complete.
// この placeholder AOI は、スクリプトを完全な形で保つためのものです。
//
// Replace it before analysis.
// 解析前に必ず置き換えてください。
//
// GeoJSON copied from tools such as Planet Insight Browser
// can be pasted here.
// Planet Insight Browser などからコピーした GeoJSON を
// ここに貼り付けられます。
// -----------------------------------------------------

var aoi = ee.Geometry({
  'type': 'Polygon',
  'coordinates': [[
    [0.0000, 0.0000],
    [0.0000, 0.1000],
    [0.1000, 0.1000],
    [0.1000, 0.0000],
    [0.0000, 0.0000]
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
  .sort('CLOUDY_PIXEL_PERCENTAGE');

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
  .filterDate(start, end);

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

var imgRaw = s2.mosaic().clip(aoi);

print('Mosaic image:', imgRaw);
print('Mosaic band names:', imgRaw.bandNames());

// Sentinel-2 optical bands are scaled by 10000.
// Sentinel-2 の光学バンドは 10000 倍で格納されています。
var img = imgRaw.divide(10000);


// -----------------------------------------------------
// 7. Cloud Probability mosaic
// 7. Cloud Probability モザイク
// -----------------------------------------------------

var cloudProbability = s2Clouds
  .mosaic()
  .clip(aoi)
  .select('probability')
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
// 10. Oil Spill Index
// 10. Oil Spill Index
//
// OSI = (Green + Red) / Blue
// OSI = (緑 + 赤) / 青
// -----------------------------------------------------

var osi = B3.add(B4)
  .divide(B2)
  .rename('OSI');


// -----------------------------------------------------
// 11. OSI anomaly
// 11. OSI anomaly
//
// Highlight pixels that differ from the local mean OSI.
// 周辺の局所平均 OSI からの差分を強調します。
// -----------------------------------------------------

var localMean = osi.reduceNeighborhood({
  reducer: ee.Reducer.mean(),
  kernel: ee.Kernel.circle({
    radius: localMeanRadiusMeters,
    units: 'meters'
  })
});

var anomaly = osi.subtract(localMean)
  .rename('OSI_anomaly');


// -----------------------------------------------------
// 12. Oil slick candidate mask
// 12. 油膜候補マスク
//
// Candidate = OSI anomaly + water mask + Cloud Probability filter
// 候補 = OSI anomaly + 水域マスク + Cloud Probability フィルタ
// -----------------------------------------------------

var baseCandidate = anomaly.abs()
  .gt(osiAnomalyThreshold)
  .and(water)
  .rename('base_oil_candidate');

var candidate = baseCandidate
  .and(cloudClear)
  .rename('oil_candidate');

var rejectedByCloudProbability = baseCandidate
  .and(cloudRejected)
  .rename('candidate_rejected_by_cloud_probability');


// -----------------------------------------------------
// 13. Minimal map visualization
// 13. 最小限の地図表示
// -----------------------------------------------------

Map.centerObject(aoi, 10);

var trueColorDisplay = img.multiply(trueColorBrightness);

var trueColorVisParams = {
  bands: ['B4', 'B3', 'B2'],
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
  candidate.updateMask(candidate),
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
  osi.updateMask(water),
  {
    min: 0.8,
    max: 2.0
  },
  'OSI over water - ' + layerSuffix,
  false
);
*/

/*
Map.addLayer(
  anomaly.updateMask(water),
  {
    min: -0.15,
    max: 0.15
  },
  'OSI anomaly - ' + layerSuffix,
  false
);
*/


// -----------------------------------------------------
// 15. Create images for export
// 15. 出力用画像の作成
// -----------------------------------------------------

var trueColorVis = trueColorDisplay.visualize(trueColorVisParams);

var candidateVis = candidate.updateMask(candidate).visualize({
  palette: ['yellow'],
  opacity: oilOpacity
});

var outputVis = trueColorVis.blend(candidateVis);


// -----------------------------------------------------
// 16. Default exports to Google Drive
// 16. Google Drive への標準出力
// -----------------------------------------------------

// True color + yellow oil candidate preview
// True color + 黄色の油膜候補プレビュー
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
  image: candidate.uint8(),
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
// OSI anomaly for later threshold testing in QGIS or other GIS tools
// QGIS などで閾値を再検討するための OSI anomaly
Export.image.toDrive({
  image: anomaly.updateMask(water).float(),
  description: exportPrefix + '_OSI_Anomaly',
  folder: exportFolder,
  fileNamePrefix: exportPrefix + '_OSI_Anomaly',
  region: aoi,
  scale: 10,
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
print('OSI anomaly threshold:', osiAnomalyThreshold);
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
//   osiAnomalyThreshold = 0.18 or 0.20
//
// If too few candidates appear:
// 候補が少なすぎる場合:
//   osiAnomalyThreshold = 0.10 or 0.08
//
// To make oil candidates stand out more on the true-color background:
// True color 背景上で油膜候補をより目立たせる場合:
//   trueColorBrightness = 0.75 or 0.8
//   trueColorMax = 0.35 or 0.4
//
// Adjust localMeanRadiusMeters as needed.
// 必要に応じて localMeanRadiusMeters を調整してください。
//
// If the water mask is too strict:
// 水域マスクが厳しすぎる場合:
//   ndwiThreshold = 0.0
