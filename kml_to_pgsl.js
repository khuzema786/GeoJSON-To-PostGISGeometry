const { readdir, readFile, rm, writeFile, mkdir } = require("fs/promises");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const { v4: uuidv4 } = require("uuid");
const reader = require("xlsx");

const typeOfMigration = "INSERT"; // "INSERT" | "UPDATE"
const sheet = 3;

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

const kmlDir = __dirname + "/assets/kml";

const pbcopy = (data) => {
  let proc = require("child_process").spawn("pbcopy");
  proc.stdin.write(data);
  proc.stdin.end();
};

(async () => {
  const file = reader.readFile(__dirname + "/assets/special-zones.xlsx");
  const xlsxData = reader.utils.sheet_to_json(
    file.Sheets[file.SheetNames[sheet]]
  );

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
  let fareProductMigration = "";

  let i = 0;
  while (i < xlsxData.length) {
    let data = xlsxData[i];
    if (data["Location Name"]) {
      try {
        const specialZoneId = uuidv4();
        const locationName = data["Location Name"];
        const category = data["Category"];
        let gates = "";

        let flag = true;
        while (i < xlsxData.length) {
          let data = xlsxData[i];
          const gate = {
            name: data["GatesInfo (name)"],
            address: data["GatesInfo (address)"],
            lat: data["GatesInfo (LatLon)"].split(",")[0].trim(),
            lon: data["GatesInfo (LatLon)"].split(",")[1].trim(),
          };
          if (flag) {
            flag = !flag;
            gates += `"GatesInfo { point = LatLong {lat = ${gate.lat}, lon = ${
              gate.lon
            }}, name = \\"${gate.name}\\", address = ${
              gate.address ? `Just \\"${gate.address}\\"` : '\\"Nothing\\"'
            } }"`;
          } else if (!data["Location Name"]) {
            gates += `, "GatesInfo { point = LatLong {lat = ${
              gate.lat
            }, lon = ${gate.lon}}, name = \\"${gate.name}\\", address = ${
              gate.address ? `Just \\"${gate.address}\\"` : '\\"Nothing\\"'
            } }"`;
          } else {
            break;
          }
          i++;
        }

        gates = "'{" + gates + "}'";

        await mkdir(`${kmlDir}/temp`, { recursive: true });
        await mkdir(`${kmlDir}/geojson`, { recursive: true });
        await exec(
          `ogr2ogr -f GeoJSON ${kmlDir}/temp/output.json ${files[locationName]
            .split(" ")
            .join("\\ ")}`
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
                // if (Array.isArray(coordinate) && Array.isArray(coordinate[0])) {
                return coordinate.map((coordinate_) => [
                  coordinate_[0],
                  coordinate_[1],
                ]);
                // } else {
                //   return [coordinate[0], coordinate[1]];
                // }
              }),
            },
          })),
        };
        await writeFile(
          `${kmlDir}/temp/output-3d.json`,
          JSON.stringify(geoJson3D)
        );
        await writeFile(
          `${kmlDir}/temp/output.json`,
          JSON.stringify(geoJson2D)
        );
        await exec(
          `ogr2ogr -f "ESRI Shapefile" ${kmlDir}/temp/output.shp ${kmlDir}/temp/output.json`
        );
        await exec(
          `shp2pgsql ${kmlDir}/temp/output.shp > ${kmlDir}/temp/output.sql`
        );
        const shapeData = await (
          await readFile(`${kmlDir}/temp/output.sql`)
        ).toString("utf8");
        const geometry = /INSERT INTO .* VALUES \(.*'(.*)'\);/gm.exec(
          shapeData
        )[1];
        await writeFile(
          `${kmlDir}/geojson/${locationName}.json`,
          JSON.stringify(geoJson2D)
        );

        if (typeOfMigration === "INSERT") {
          specialLocationMigration += `INSERT INTO atlas_driver_offer_bpp.special_location (id, location_name, category, gates, geom, created_at)
    VALUES
    ( '${specialZoneId}'
    , '${locationName}'
    , '${category}'
    , ${gates}
    , '${geometry}'
    , now()
    );\n`;

          fareProductMigration += farePolicy
            .map(
              ({ id, variant }) =>
                `INSERT INTO atlas_driver_offer_bpp.fare_product (id, merchant_id, fare_policy_id, vehicle_variant, "area", flow) VALUES ('${uuidv4()}','7f7896dd-787e-4a0b-8675-e9e6fe93bb8f','${id}','${variant}','Pickup_${specialZoneId}','NORMAL');\nINSERT INTO atlas_driver_offer_bpp.fare_product (id, merchant_id, fare_policy_id, vehicle_variant, "area", flow) VALUES ('${uuidv4()}','7f7896dd-787e-4a0b-8675-e9e6fe93bb8f','${id}','${variant}','Drop_${specialZoneId}','NORMAL');\n`
            )
            .join("");
        } else if (typeOfMigration === "UPDATE") {
          specialLocationMigration += `UPDATE atlas_driver_offer_bpp.special_location SET location_name = '${locationName}', category = '${category}', gates = ${gates}, geom = '${geometry}' WHERE location_name = '${locationName}';\n`;
        }
        specialLocationMigration += `SELECT ST_AsGeoJSON(ST_MakeValid('${geometry}')) AS geojson;\n`;
        console.log(`done : ${files[locationName]}`);
      } catch (err) {
        console.log(`skipped : ${files[data["Location Name"]]}`, err);
        continue;
      } finally {
        await rm(`${kmlDir}/temp`, { recursive: true, force: true });
      }
    }
  }

  await rm(`${kmlDir}/temp`, { recursive: true, force: true });
  await rm(__dirname + "/assets/migrations", { recursive: true, force: true });
  // pbcopy(migration);
  await mkdir(__dirname + "/assets/migrations", { recursive: true });
  await writeFile(
    __dirname + "/assets/migrations/special-location.sql",
    specialLocationMigration
  );
  await writeFile(
    __dirname + "/assets/migrations/fare-product.sql",
    fareProductMigration
  );
})();
