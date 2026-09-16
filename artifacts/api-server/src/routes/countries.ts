import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  countriesTable,
  citiesTable,
  bdDivisionsTable,
  bdDistrictsTable,
} from "@workspace/db";
import geoip from "geoip-lite";
import { getClientIp } from "../lib/currency";

const countryNames: Record<string, string> = {
  BD: "Bangladesh",
  IN: "India",
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  SG: "Singapore",
  MY: "Malaysia",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  PK: "Pakistan",
  LT: "Lithuania",
};

function normalizeLocationName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[.,'’`-]/g, " ")
    .replace(/\s+/g, " ");
}

const router: IRouter = Router();

router.get("/countries", async (_req, res): Promise<void> => {
  const countries = await db
    .select()
    .from(countriesTable)
    .orderBy(countriesTable.name);

  res.json(countries);
});

router.post("/countries", async (req, res): Promise<void> => {
  const { name, code, dialCode, flag } = req.body;

  if (!name || !code) {
    res.status(400).json({ error: "name and code required" });
    return;
  }

  const [c] = await db
    .insert(countriesTable)
    .values({ name, code, dialCode, flag })
    .returning();

  res.status(201).json(c);
});

router.get("/cities", async (req, res): Promise<void> => {
  const { countryId } = req.query as Record<string, string>;

  const conditions = countryId
    ? [eq(citiesTable.countryId, parseInt(countryId))]
    : [];

  const cities = conditions.length
    ? await db
        .select()
        .from(citiesTable)
        .where(conditions[0])
        .orderBy(citiesTable.name)
    : await db
        .select()
        .from(citiesTable)
        .orderBy(citiesTable.name);

  res.json(cities);
});

router.post("/cities", async (req, res): Promise<void> => {
  const { name, countryId } = req.body;

  if (!name || !countryId) {
    res.status(400).json({ error: "name and countryId required" });
    return;
  }

  const [c] = await db
    .insert(citiesTable)
    .values({ name, countryId })
    .returning();

  res.status(201).json(c);
});

router.get("/locations/detect", async (req, res): Promise<void> => {
  const ip = getClientIp(req);

  console.log("[GEO DEBUG]", {
    cfConnectingIp: req.headers["cf-connecting-ip"],
    xForwardedFor: req.headers["x-forwarded-for"],
    socketIp: req.socket?.remoteAddress,
    detectedIp: ip,
  });

  if (!ip) {
    res.json({
      country: "BD",
      countryName: "Bangladesh",
      city: null,
      cityId: null,
      districtId: null,
      districtName: null,
      divisionId: null,
      divisionName: null,
      detected: false,
    });
    return;
  }

  try {
    const geo = geoip.lookup(ip);

    console.log("[GEO RESULT]", {
      ip,
      geo,
    });

    if (geo?.country) {
      let cityId: number | null = null;
      let districtId: number | null = null;
      let districtName: string | null = null;
      let divisionId: number | null = null;
      let divisionName: string | null = null;

      if (geo.city) {
        const [matchedCity] = await db
          .select()
          .from(citiesTable)
          .where(
            sql`lower(${citiesTable.name}) = lower(${geo.city})`,
          )
          .limit(1);

        cityId = matchedCity?.id ?? null;
      }

      /*
       * Bangladesh:
       * GeoIP city -> Bangladesh district -> division.
       *
       * Example:
       * Rangpur -> Rangpur District -> Rangpur Division (7)
       * Natore  -> Natore District  -> Rajshahi Division (2)
       */
      if (geo.country === "BD" && geo.city) {
        const normalizedCity = normalizeLocationName(geo.city);

        const districts = await db
          .select()
          .from(bdDistrictsTable);

        const matchedDistrict = districts.find((district) => {
          const districtName = normalizeLocationName(district.name);
          const districtBnName = normalizeLocationName(district.bnName);

          return (
            districtName === normalizedCity ||
            districtBnName === normalizedCity
          );
        });

        if (matchedDistrict) {
          districtId = matchedDistrict.id;
          districtName = matchedDistrict.name;

          const [matchedDivision] = await db
            .select()
            .from(bdDivisionsTable)
            .where(eq(bdDivisionsTable.id, matchedDistrict.divisionId))
            .limit(1);

          if (matchedDivision) {
            divisionId = matchedDivision.id;
            divisionName = matchedDivision.name;
          }
        }
      }

      res.json({
        country: geo.country,
        countryName: countryNames[geo.country] ?? geo.country,
        city: geo.city ?? null,
        cityId,
        districtId,
        districtName,
        divisionId,
        divisionName,
        detected: true,
      });

      return;
    }

    res.json({
      country: "BD",
      countryName: "Bangladesh",
      city: null,
      cityId: null,
      districtId: null,
      districtName: null,
      divisionId: null,
      divisionName: null,
      detected: false,
    });
  } catch (error) {
    console.error("[GEO ERROR]", error);

    res.json({
      country: "BD",
      countryName: "Bangladesh",
      city: null,
      cityId: null,
      districtId: null,
      districtName: null,
      divisionId: null,
      divisionName: null,
      detected: false,
    });
  }
});

export default router;
