# Parcels

A personal, Regrid-style parcel map for Idaho. It's a web app that works on a phone or computer:

- **Parcel lines** over a street map or satellite imagery
- **Tap a parcel** to see the owner, mailing address, acres, values, class, zoning and legal description
- **"Parcel here"** uses GPS to show the parcel you're standing in
- **Search** by address, owner name or parcel number
- **Save parcels and write private notes.** They're stored on your device, with export/import for backups
- Can be **installed to your home screen** (it's a PWA)

The data comes straight from county assessors. Nothing is bought, and nothing is copied from Regrid.

## Coverage

Idaho has no free statewide parcel layer, so each county is added one at a time.
`data/sources.yaml` lists all 44 counties and their status (`make status`).

| County   | Status | Owners? | Source |
|----------|--------|---------|--------|
| Ada      | ✅ on the map (224,645 parcels) | ❌ county leaves them out; the app links to the county property lookup | official free download |
| Kootenai | ✅ on the map (94,955 parcels) | ✅ owner + mailing address | county assessor map service |
| Canyon   | ⏳ free, but you have to ask | ✅ (parcel ownership table) | FTP login emailed by the Assessor's Plat Room |
| other 41 | not researched yet | | |

**About owner names:** Idaho Code 74-120 bars handing out lists of names and addresses for use as a mailing list.
For that reason some counties, like Ada, leave owners out of bulk downloads. Keep this app private (see *Deploy*);
don't publish it or use it to build mailing lists.

**Not used:** the IDWR statewide parcel service (`gis.idwr.idaho.gov/.../Reference/Parcels`). It covers almost every
county, but its terms say *"This dataset cannot be shared outside IDWR."*

## Quick start

Needs Python 3.10+, Node 20+, and [tippecanoe](https://github.com/felt/tippecanoe)
(`brew install tippecanoe` on a Mac; on Linux, build it from source, or point `TIPPECANOE=/path/to/tippecanoe` at a binary).

```bash
make setup     # Python + npm packages
make data      # download Ada + Kootenai, build map files (~2 min, ~100 MB)
make dev       # open http://localhost:5173
```

On your phone (same Wi-Fi), open the "Network" address Vite prints. GPS needs HTTPS on a real phone, so use the deployed site for field work.

## How it works

```
data/sources.yaml ──► pipeline/fetch.py ──► data/raw/<county>/        (downloads)
                      pipeline/normalize.py ──► data/work/<county>.geojsonl (common schema)
                      pipeline/build.py ──► web/public/data/
                                              parcels.pmtiles   one tile file, every county
                                              search/<county>.json.gz
                                              counties.json     coverage + per-county info
web/  (Vite + TypeScript + MapLibre GL)  reads those files; no server or database.
```

- **Tiles:** zooms 11–13 hold outlines only (tapping zooms in); zooms 14–15 hold every attribute.
  Address labels come from a separate point layer, so they don't repeat across tile edges.
- **Common schema:** `pid, alt_id, owner, mail_addr, situs_addr, situs_city, acres, land_val, impr_val, total_val, net_val, prop_class, zoning, subdivision, legal`.
  When a county doesn't report acres, they're calculated from the shape and marked "(calculated)".
- **Basemaps:** OpenFreeMap streets and USGS National Map imagery. Both are free and need no API key.

## Adding a county

1. Find the county's parcel data on the assessor or GIS website. ArcGIS sites have a REST directory such as `.../arcgis/rest/services`.
2. Check the terms of use, and whether owner names are included.
3. Fill in its entry in `data/sources.yaml`. Use `type: arcgis_rest` with `url` and `layers`, or `type: download` with a zip URL
   (`file:///path/to/file.zip` works for data you were emailed). Then map its field names under `fields:`, using Ada or Kootenai as examples.
4. `make data COUNTY=<key>`, then `make dev` and tap around to check the fields look right.

To refresh the data, run `make data` every few months. Counties update at different times; the app shows each county's download date.

## Deploy (private, about $0/month)

The site goes on **Cloudflare Pages**, the data files on **Cloudflare R2**, and **Cloudflare Access** makes sure only you can open it.
All three have free tiers that cover this.

1. Create an R2 bucket (e.g. `idaho-parcels`), then `npx wrangler login` and `make upload BUCKET=idaho-parcels`.
   Wrangler uploads files up to about 300 MB; once statewide tiles get bigger than that, use `rclone` or the R2 S3 API.
2. Create a Pages project from this repo. Settings: root directory `web`, build command `npm run build`, output `dist`.
   Under *Settings → Functions → R2 bindings*, bind the bucket as **`PARCELS`**.
   `web/functions/data/[[path]].js` then serves `/data/*` from R2, with the Range support that PMTiles needs.
3. Under *Zero Trust → Access → Applications*, add a self-hosted app for your `*.pages.dev` domain, including preview URLs,
   with a policy that allows only your email address.

## Tests

```bash
make dev            # in one terminal
make test           # in another: 17 browser checks
```

The tests use Playwright (`npm i -g playwright` if you don't have it). They check:
- tapping a parcel shows its owner and values
- notes persist after a reload, and export/import works
- search by address and by owner
- the satellite basemap
- GPS "Parcel here" (with a fake location)
- tapping at a low zoom zooms in
- a phone layout

## Limitations

- **Coverage:** only Ada and Kootenai so far; the other counties need research, one at a time.
- **Owners:** missing wherever the county leaves them out of its bulk data (Ada).
- **Accuracy:** parcel lines are the assessors' maps, not surveys.
- **Notes:** saved on one device only. Use export/import to move them between devices.
- **Offline:** the app itself loads offline once installed, but map tiles need a connection.
