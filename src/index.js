const { readdir, readFile, rm, writeFile, mkdir } = require("fs/promises");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const { v4: uuidv4 } = require("uuid");
const reader = require("xlsx");
const puppeteer = require("puppeteer");

const typeOfMigration = "INSERT"; // "INSERT" | "UPDATE"

const merchantId = "7f7896dd-787e-4a0b-8675-e9e6fe93bb8f";
const priority = [2, 3];

const farePolicy = [
  {
    id: "81b52524-e773-03dc-5853-290131ce6fd6",
    variant: "TAXI",
  },
  {
    id: "81b52524-e773-03dc-5853-290131ce6fd6",
    variant: "SEDAN",
  },
  {
    id: "cd122b6d-183d-52c1-110e-63237995bae4",
    variant: "TAXI_PLUS",
  },
  {
    id: "cd122b6d-183d-52c1-110e-63237995bae4",
    variant: "SUV",
  },
  {
    id: "cd122b6d-183d-52c1-110e-63237995bae4",
    variant: "HATCHBACK",
  },
  {
    id: "cd122b6d-183d-52c1-110e-63237995bae4",
    variant: "AUTO_RICKSHAW",
  },
];

const assetsDir = __dirname + "/assets";
const kmlDir = assetsDir + "/kml";

const pbcopy = (data) => {
  let proc = require("child_process").spawn("pbcopy");
  proc.stdin.write(data);
  proc.stdin.end();
};

let allGeoJsons = [];

const generateMap = async (locationName) => {
  // Create a simple HTML file with Leaflet
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Leaflet Map</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
  <style>
    body { margin: 0; }
    #map { height: 100vh; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = L.map('map').setView([0, 0], 2); // Set initial view
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // Loop through GeoJSONs and add them as layers
    ${allGeoJsons
      .map(
        (geoJson, index) => `
    const geoJsonLayer${index} = L.geoJSON(${JSON.stringify(geoJson)});
    geoJsonLayer${index}.addTo(map);
    `
      )
      .join("\n")}

    // Zoom to the bounds of all GeoJSON layers
    const group = new L.featureGroup([${allGeoJsons
      .map((_, index) => `geoJsonLayer${index}`)
      .join(",")}]);
    map.fitBounds(group.getBounds());
  </script>
</body>
</html>
`;

  // Launch a headless browser
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Set the content of the page
  await page.setContent(html, { waitUntil: ["domcontentloaded", "load"] });

  // Capture a screenshot of the map
  await page.screenshot({
    path: `${assetsDir}/maps/${locationName}.png`,
    fullPage: true,
  });

  // Close the browser
  await browser.close();
};

const getGeometry = async (files, locationName) => {
  await mkdir(`${kmlDir}/temp`, { recursive: true });
  await mkdir(`${assetsDir}/geojson`, { recursive: true });
  await mkdir(`${assetsDir}/maps`, { recursive: true });

  await exec(
    `ogr2ogr -f GeoJSON ${kmlDir}/temp/output.json ${files[locationName]
      .split(" ")
      .join("\\ ")
      .replace("'", "\\'")
      .replace("(", "\\(")
      .replace(")", "\\)")}`
  );
  let geoJson3D = JSON.parse(
    await (await readFile(`${kmlDir}/temp/output.json`)).toString("utf8")
  );
  const geoJson2D = {
    ...geoJson3D,
    features: geoJson3D.features.map((feature) => ({
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: feature.geometry.coordinates.map((coordinate) => {
          return coordinate.map((coordinate_) => [
            coordinate_[0],
            coordinate_[1],
          ]);
        }),
      },
    })),
  };
  await writeFile(`${kmlDir}/temp/output-3d.json`, JSON.stringify(geoJson3D));
  await writeFile(`${kmlDir}/temp/output.json`, JSON.stringify(geoJson2D));
  allGeoJsons.push(geoJson2D);
  await exec(
    `ogr2ogr -f "ESRI Shapefile" ${kmlDir}/temp/output.shp ${kmlDir}/temp/output.json`
  );
  await exec(`shp2pgsql ${kmlDir}/temp/output.shp > ${kmlDir}/temp/output.sql`);
  const shapeData = await (
    await readFile(`${kmlDir}/temp/output.sql`)
  ).toString("utf8");
  const geometry = /INSERT INTO .* VALUES \(.*'(.*)'\);/gm.exec(shapeData)[1];
  await writeFile(
    `${assetsDir}/geojson/${locationName}.json`,
    JSON.stringify(geoJson2D)
  );
  return geometry;
};

(async () => {
  const file = reader.readFile(assetsDir + `/special-zones.xlsx`);
  const xlsxData = reader.utils.sheet_to_json(file.Sheets[file.SheetNames[0]]);

  const files = {};
  const processDir = async (dirname) => {
    try {
      const items = await readdir(dirname, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          await processDir(`${dirname}/${item.name}`);
        } else if (item.name.match(/.*\.kml/gm)) {
          files[item.name.split(".kml")[0].trim()] = `${dirname}/${item.name}`;
        }
      }
    } catch (err) {}
  };
  await processDir(kmlDir);

  let specialLocationMigration = "";
  let specialLocationGatesMigration = "";
  let specialLocationPriorityMigration = "";
  let fareProductMigration = "";

  let i = 0;
  while (i < xlsxData.length) {
    allGeoJsons = [];
    let data = xlsxData[i];
    const locationName = data["Location Name"];
    if (locationName) {
      try {
        if (!files[locationName]) {
          console.log(`File ${locationName}.kml not found.`);
          i++;
          continue;
        }

        const specialZoneId = uuidv4();
        const category = data["Category"];
        const gates = [];
        let gatesAsStr = "";

        let flag = true;
        while (i < xlsxData.length) {
          let data = xlsxData[i];
          if (!flag && data["Location Name"]) break;
          const gateName = data["GatesInfo (name)"].replaceAll("'", "''");
          console.log(
            `Gate => ${gateName + "___" + locationName}`,
            `Geom => ${data["GatesInfo (geom)"] === "TRUE"}`
          );
          const gate = {
            name: gateName,
            address: data["GatesInfo (address)"].replaceAll("'", "''"),
            driver_extra: data["GatesInfo (default_driver_extra)"].toString(),
            can_queue_up: data["GatesInfo (can_queue_up_on_gate)"].replaceAll(
              "'",
              "''"
            ),
            lat: data["GatesInfo (LatLon)"].split(",")[0]?.trim(),
            lon: data["GatesInfo (LatLon)"].split(",")[1]?.trim(),
            geom:
              data["GatesInfo (geom)"] === "TRUE"
                ? await getGeometry(files, gateName + "___" + locationName)
                : null,
          };
          gates.push(gate);
          if (flag) {
            flag = !flag;
            gatesAsStr += `"GatesInfo { point = LatLong {lat = ${
              gate.lat
            }, lon = ${gate.lon}}, name = \\"${gate.name}\\", address = ${
              gate.address ? `Just \\"${gate.address}\\"` : '\\"Nothing\\"'
            } }"`;
          } else {
            gatesAsStr += `, "GatesInfo { point = LatLong {lat = ${
              gate.lat
            }, lon = ${gate.lon}}, name = \\"${gate.name}\\", address = ${
              gate.address ? `Just \\"${gate.address}\\"` : '\\"Nothing\\"'
            } }"`;
          }

          i++;
        }

        gatesAsStr = "'{" + gatesAsStr + "}'";

        const geometry = await getGeometry(files, locationName);
        await generateMap(locationName);

        if (typeOfMigration === "INSERT") {
          specialLocationMigration += `INSERT INTO atlas_driver_offer_bpp.special_location (id, location_name, category, gates, geom, created_at)
    VALUES
    ( '${specialZoneId}'
    , '${locationName.replaceAll("'", "''")}'
    , '${category}'
    , ${gatesAsStr}
    , '${geometry}'
    , now()
    );\n`;

          specialLocationGatesMigration += gates
            .map(
              (gate) =>
                `INSERT INTO atlas_driver_offer_bpp.gate_info (id, point, special_location_id, default_driver_extra, name, geom, address, can_queue_up_on_gate) VALUES ('${uuidv4()}','LatLong {lat = ${
                  gate.lat
                }, lon = ${gate.lon}}','${specialZoneId}','${
                  gate.driver_extra
                }','${gate.name}',${gate.geom ? `'${gate.geom}'` : "NULL"},'${
                  gate.address
                }',${gate.can_queue_up.toLowerCase()});\n`
            )
            .join("");

          specialLocationPriorityMigration += `INSERT INTO atlas_driver_offer_bpp.special_location_priority (id, merchant_id, category, pickup_priority, drop_priority) VALUES ('${uuidv4()}', '${merchantId}', '${category}', ${
            priority[0]
          }, ${priority[1]});\n`;

          fareProductMigration += farePolicy
            .map(
              ({ id, variant }) =>
                `INSERT INTO atlas_driver_offer_bpp.fare_product (id, merchant_id, fare_policy_id, vehicle_variant, "area", flow) VALUES ('${uuidv4()}','${merchantId}','${id}','${variant}','Pickup_${specialZoneId}','NORMAL');\nINSERT INTO atlas_driver_offer_bpp.fare_product (id, merchant_id, fare_policy_id, vehicle_variant, "area", flow) VALUES ('${uuidv4()}','${merchantId}','${id}','${variant}','Drop_${specialZoneId}','NORMAL');\n`
            )
            .join("");
        } else if (typeOfMigration === "UPDATE") {
          specialLocationMigration += `UPDATE atlas_driver_offer_bpp.special_location SET location_name = '${locationName.replaceAll(
            "'",
            "''"
          )}', category = '${category}', gates = ${gatesAsStr}, geom = '${geometry}' WHERE location_name = '${locationName.replaceAll(
            "'",
            "''"
          )}';\n`;

          specialLocationGatesMigration += gates
            .map(
              (gate) =>
                `INSERT INTO atlas_driver_offer_bpp.gate_info (id, point, special_location_id, default_driver_extra, name, geom, address, can_queue_up_on_gate) VALUES ('${uuidv4()}','LatLong {lat = ${
                  gate.lat
                }, lon = ${gate.lon}}','${specialZoneId}','${
                  gate.driver_extra
                }','${gate.name}',${gate.geom ? `'${gate.geom}'` : "NULL"},'${
                  gate.address
                }',${gate.can_queue_up.toLowerCase()});\n`
            )
            .join("");
        }
        specialLocationMigration += `SELECT ST_AsGeoJSON(ST_MakeValid('${geometry}')) AS geojson;\n`;
        console.log(`done : ${files[locationName]}`);
      } catch (err) {
        console.log(`skipped : ${files[data["Location Name"]]}`, err);
        i++;
        continue;
      } finally {
        await rm(`${kmlDir}/temp`, { recursive: true, force: true });
        continue;
      }
    } else {
      i++;
      continue;
    }
  }

  await rm(`${kmlDir}/temp`, { recursive: true, force: true });
  await rm(assetsDir + "/migrations", { recursive: true, force: true });
  // pbcopy(migration);
  await mkdir(assetsDir + "/migrations", { recursive: true });
  await writeFile(
    assetsDir + "/migrations/special-location.sql",
    specialLocationMigration
  );
  await writeFile(
    assetsDir + "/migrations/special-location-gates.sql",
    specialLocationGatesMigration
  );
  await writeFile(
    assetsDir + "/migrations/special-location-priority.sql",
    specialLocationPriorityMigration
  );
  await writeFile(
    assetsDir + "/migrations/fare-product.sql",
    fareProductMigration
  );
})();
