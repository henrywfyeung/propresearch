#!/usr/bin/env bash
# scripts/build-catchments.sh — one-off / annual preprocessing for school-catchment
# point-in-polygon (Node 17). Downloads the two government open datasets, converts
# the shapefiles/GeoJSON to compact, simplified GeoJSON with a common `school`
# field, and writes them to src/data/catchments/. NOT run at request time.
#
#   NSW — NSW Dept of Education "School Intake Zones" (CC BY). GDA94 shapefile.
#         USE_DESC = school name, CATCH_TYPE = primary/high-coed/boys/girls.
#   VIC — VIC Dept of Education "School Zones" (CC BY 4.0). Ships GeoJSON already
#         in CRS84 (WGS84); School_Name = school name. Secondary split by year —
#         we take Year 7 (entry year) as the designated secondary zone.
#
# Re-run annually and bump VIC_YEAR. Requires curl, unzip, and npx (mapshaper).
set -euo pipefail

VIC_YEAR=2026
OUT="src/data/catchments"
TMP="$(mktemp -d)"
MS="npx --yes mapshaper@0.6.110"
SIMPLIFY="15%"   # Douglas-Peucker; catchment edges tolerate a few metres for PIP

NSW_URL="https://data.nsw.gov.au/data/dataset/8b1e8161-7252-43d9-81ed-6311569cb1d7/resource/32d6f502-ddb1-45d9-b114-5e34ddfd33ac/download/catchments.zip"
VIC_URL="https://www.education.vic.gov.au/Documents/about/research/datavic/dv418_DataVic_School_Zones_${VIC_YEAR}_MAR${VIC_YEAR: -2}.zip"

mkdir -p "$OUT"
echo "tmp: $TMP"

echo "== download =="
curl -sL --max-time 240 -o "$TMP/nsw.zip" "$NSW_URL"
curl -sL --max-time 240 -o "$TMP/vic.zip" "$VIC_URL"
unzip -o -q "$TMP/nsw.zip" -d "$TMP/nsw"
unzip -o -q "$TMP/vic.zip" -d "$TMP/vic"

echo "== NSW (GDA94 shapefile -> wgs84) =="
$MS "$TMP/nsw/catchments_primary.shp" -proj wgs84 \
  -filter-fields USE_DESC,CATCH_TYPE -rename-fields school=USE_DESC,catchType=CATCH_TYPE \
  -simplify "$SIMPLIFY" keep-shapes -o format=geojson "$OUT/nsw-primary.geojson" 2>/dev/null
$MS "$TMP/nsw/catchments_secondary.shp" -proj wgs84 \
  -filter-fields USE_DESC,CATCH_TYPE -rename-fields school=USE_DESC,catchType=CATCH_TYPE \
  -simplify "$SIMPLIFY" keep-shapes -o format=geojson "$OUT/nsw-secondary.geojson" 2>/dev/null

echo "== VIC (already CRS84/WGS84) =="
$MS "$TMP/vic/Primary_Integrated_${VIC_YEAR}.geojson" \
  -filter-fields School_Name -rename-fields school=School_Name \
  -simplify "$SIMPLIFY" keep-shapes -o format=geojson "$OUT/vic-primary.geojson" 2>/dev/null
$MS "$TMP/vic/Secondary_Integrated_Year7_${VIC_YEAR}.geojson" \
  -filter-fields School_Name -rename-fields school=School_Name \
  -simplify "$SIMPLIFY" keep-shapes -o format=geojson "$OUT/vic-secondary.geojson" 2>/dev/null

echo "== gzip (committed as .geojson.gz; the loader gunzips at runtime) =="
for f in "$OUT"/*.geojson; do gzip -9 -f "$f"; done

echo "== result =="
ls -lh "$OUT"/*.geojson.gz | awk '{print $9, $5}'
rm -rf "$TMP"
echo "done"
