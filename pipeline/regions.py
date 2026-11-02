"""Study regions. bbox = (west, south, east, north) in WGS84."""

REGIONS = {
    "colorado_2020": dict(
        name="Colorado Front Range", year=2020, bbox=(-109.0, 39.0, -104.9, 41.1),
        firms="modis_2020_United_States.csv", truth=True,
        blurb="Cameron Peak and East Troublesome: the two largest fires in Colorado history, "
              "plus CalWood above Boulder. Forest fuels; East Troublesome grew by about 87,000 acres in a single day.",
        center=(-106.4, 40.3), zoom=7.2),
    "ncal_2020": dict(
        name="Northern California", year=2020, bbox=(-124.2, 38.3, -120.8, 40.9),
        firms="modis_2020_United_States.csv", truth=True,
        blurb="The August 2020 lightning siege. The August Complex began as dozens of separate lightning "
              "ignitions that grew together, so even the official record has to decide what counts as one fire.",
        center=(-122.5, 39.6), zoom=7.0),
    "oregon_2020": dict(
        name="Oregon Cascades", year=2020, bbox=(-123.9, 42.6, -121.6, 45.3),
        firms="modis_2020_United_States.csv", truth=True,
        blurb="The Labor Day 2020 east-wind event: Beachie Creek, Lionshead, Riverside, Holiday Farm and "
              "Archie Creek. Fires that burned for weeks then exploded in a single night.",
        center=(-122.6, 44.0), zoom=7.0),
    "arizona_2020": dict(
        name="Central & Southern Arizona", year=2020, bbox=(-113.0, 31.3, -109.0, 35.0),
        firms="modis_2020_United_States.csv", truth=True,
        blurb="Desert grassland, chaparral and sky-island forest: the Bush and Bighorn fires alongside "
              "many smaller fires, with very different fuels sitting close together.",
        center=(-111.0, 33.1), zoom=6.8),
    "idaho_2020": dict(
        name="Southwest Idaho", year=2020, bbox=(-117.3, 42.0, -113.5, 44.6),
        firms="modis_2020_United_States.csv", truth=True,
        blurb="Sagebrush steppe on the Snake River Plain around Boise. Rangeland fires driven by cheatgrass "
              "can cover huge areas in a day or two, then go out.",
        center=(-115.4, 43.3), zoom=7.0),
    "flinthills_2020": dict(
        name="Kansas Flint Hills", year=2020, bbox=(-97.5, 37.0, -95.8, 39.5),
        firms="modis_2020_United_States.csv", truth=False,
        blurb="Tallgrass prairie with intensive spring prescribed burning: thousands of small, adjacent, "
              "deliberately lit fires. No perimeters exist for most of them.",
        center=(-96.6, 38.3), zoom=7.3),
    "kalimantan_2019": dict(
        name="Central Kalimantan, Indonesia", year=2019, bbox=(111.0, -3.8, 115.5, -0.5),
        firms="modis_2019_Indonesia.csv", truth=False,
        blurb="Tropical peatland and the former Mega Rice Project, where Cattau's clustering algorithm was "
              "first applied. 2019 was a severe El Niño fire year; no national perimeter or ignition records exist.",
        center=(113.6, -2.4), zoom=7.3),
}
