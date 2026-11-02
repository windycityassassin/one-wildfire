// Sources: every claim on the page is a link. Clicking it opens a portal over the story: a short page that
// says where the claim comes from and explains a little more, or (for claims with a \`page\`) a full proof
// page with its own charts and data. The same sources are listed, numbered, at the end of the page.
// Numbers follow the order in which each source first appears.

export const REFS = {
  soda: {
    title: "The Soda Fire",
    body: `<p>Lightning started the fire on <b>10 August 2015</b> in Owyhee County, southwest Idaho, close to the Oregon border. It was contained on <b>23 August</b>, after burning into Malheur County, Oregon.</p>
      <p>The official perimeter record gives it <b>279,144 acres</b> (about 1,130 km²). The Bureau of Land Management describes it as "nearly 280,000 acres", driven by "high temperatures, low relative humidity and high sustained winds".</p>`,
    src: `Bureau of Land Management (2016). <i>Soda Fire Emergency Stabilization and Rehabilitation: status report</i>. BLM Boise District. <a href="https://www.blm.gov/sites/blm.gov/files/Program_FishandWildlife_WildllifeIdahoSodaFireESR_StatusReport.pdf" target="_blank" rel="noopener">blm.gov (PDF)</a>. Perimeter: National Interagency Fire Center, <i>Interagency Fire Perimeter History</i>, record 2015-IDOYD-000889. <a href="https://data-nifc.opendata.arcgis.com/datasets/nifc::interagencyfireperimeterhistory-all-years-view/about" target="_blank" rel="noopener">data-nifc.opendata.arcgis.com</a>`,
  },
  modis: {
    title: "The satellites",
    body: `<p>The hot spots come from <b>MODIS</b>, a sensor on two NASA satellites, Terra and Aqua. Both orbit <b>705 km</b> above the Earth, which is where this story starts.</p>
      <p>Terra crosses the equator in the morning and Aqua in the afternoon, and each sees most of the planet twice a day, so a large fire is seen again and again as it grows.</p>`,
    src: `NASA, <i>MODIS specifications</i> ("Orbit: 705 km"). <a href="https://modis.gsfc.nasa.gov/about/specifications.php" target="_blank" rel="noopener">modis.gsfc.nasa.gov</a>`,
  },
  strike: {
    title: "Where the bolt is drawn",
    body: `<p>The records say lightning started the Soda Fire on 10 August 2015, but the exact spot it struck is not in the data I used. So the bolt lands in the middle of the first hot spots a satellite saw: Aqua's, at <b>2:07 pm</b> local time that day.</p>
      <p>The squares that follow are the hot spots of the fire's first day and a half, in the order the satellites saw them. Each is white when it appears, then turns yellow, orange and red, at the same speed as on every other map of the fire here; only the five-day map lets them burn out to dark. "Earlier that day" is as precise as the records allow: the fire started on 10 August and was first seen at 2:07 pm.</p>`,
    src: `Cause and date: BLM (2016), <a href="https://www.blm.gov/sites/blm.gov/files/Program_FishandWildlife_WildllifeIdahoSodaFireESR_StatusReport.pdf" target="_blank" rel="noopener">status report</a>. First hot spots: NASA FIRMS MODIS C6.1 (Aqua, 10 August 2015, 20:07 UTC), <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">firms.modaps.eosdis.nasa.gov</a>.`,
  },
  pass: {
    title: "One pass",
    body: `<p>This is the first pass that saw the fire: <b>Aqua, at 2:07 pm on 10 August 2015</b>. MODIS sweeps its view from side to side as the satellite flies, scanning a strip of Earth <b>2,330 km</b> wide. Aqua crosses the equator heading north in the early afternoon.</p>
      <p>The fire was near the western edge of that strip: its first hot spots were about <b>3 km</b> wide, against about 1 km straight below the satellite. So the path is drawn about 870 km east of the fire. That distance and the path's tilt are my estimates. The satellite is drawn far larger than life.</p>`,
    src: `NASA, <i>MODIS specifications</i> ("Swath Dimensions: 2330 km (cross track)"; "1:30 p.m. ascending node (Aqua)"). <a href="https://modis.gsfc.nasa.gov/about/specifications.php" target="_blank" rel="noopener">modis.gsfc.nasa.gov</a>. Pixel size of the first pass (3.1 × 1.7 km): NASA FIRMS MODIS C6.1, <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">firms.modaps.eosdis.nasa.gov</a>.`,
  },
  firms: {
    title: "Hot spots, 1 km wide",
    body: `<p>Each square is one MODIS fire detection: a pixel that was hotter than its surroundings. Directly below the satellite a pixel covers about <b>1 km²</b>; towards the edge of each pass it is larger.</p>
      <p>I kept the 652 detections that fall inside the official Soda Fire perimeter (vegetation fires, confidence 30 or higher), from 10 to 15 August 2015.</p>`,
    src: `NASA FIRMS, MODIS Collection 6.1 active fire locations (MCD14ML), <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">firms.modaps.eosdis.nasa.gov</a>. Giglio, L., Schroeder, W., Justice, C.O. (2016). The collection 6 MODIS active fire detection algorithm and fire products. <i>Remote Sensing of Environment</i> 178: 31–41. <a href="https://doi.org/10.1016/j.rse.2016.02.054" target="_blank" rel="noopener">doi:10.1016/j.rse.2016.02.054</a>. Giglio, L. et al. (2021). <i>MODIS Collection 6 and 6.1 Active Fire Product User's Guide</i> ("nominally 1 km²"). <a href="https://lpdaac.usgs.gov/documents/1005/MOD14_User_Guide_V61.pdf" target="_blank" rel="noopener">lpdaac.usgs.gov (PDF)</a>`,
  },
  cattau2016: {
    title: "The rule from 2016",
    body: `<p>To turn hot spots into fires, Cattau and colleagues joined detections that fall in the <b>same 1 km cell or any of the 8 cells around it</b>, within <b>4 days</b> of each other. A fire can keep growing, cell by cell, as long as each new detection touches it.</p>
      <p>They tested time windows from 1 to 14 days and chose 4 as a cautious setting. The rule was built for peat fires in Indonesia, which smoulder slowly in one place. A sagebrush fire pushed by wind moves much faster.</p>`,
    src: `Cattau, M.E., Harrison, M.E., Shinyo, I., Tungau, S., Uriarte, M., DeFries, R. (2016). Sources of anthropogenic fire ignitions on the peat-swamp landscape in Kalimantan, Indonesia. <i>Global Environmental Change</i> 39: 205–219. <a href="https://doi.org/10.1016/j.gloenvcha.2016.05.005" target="_blank" rel="noopener">doi:10.1016/j.gloenvcha.2016.05.005</a>. Method quoted from the open version: Cattau, M.E. (2016), PhD dissertation, Columbia University, ch. 2. <a href="https://doi.org/10.7916/D8XG9RB7" target="_blank" rel="noopener">doi:10.7916/D8XG9RB7</a>`,
  },
  rerun: {
    title: "38 fires",
    body: `<p>This is my re-run of the 2016 rule on the Soda Fire's 652 detections. Working from detection centres rather than a grid, two detections join the same group if they are within <b>1.5 km and 4 days</b> of each other (about the reach of "the same or a neighbouring 1 km cell"). That gives <b>38 groups</b>.</p>
      <p>With "a little more room" (4 km and 14 days) there are 3 groups, and the biggest holds 99% of the detections.</p>`,
    src: `My analysis. Details: <a href="methods.html">How this was made</a>.`,
  },
  la: {
    title: "As big as Los Angeles",
    body: `<p>279,144 acres is about <b>1,130 km²</b> (436 square miles). The city of Los Angeles covers <b>1,219 km²</b> of land (470.5 square miles). The fire burned an area about 93% the size of the city.</p>`,
    src: `U.S. Census Bureau, 2024 Gazetteer Files, Places: Los Angeles city, California (GEOID 0644000). <a href="https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html" target="_blank" rel="noopener">census.gov</a>`,
  },
  fires: {
    title: "Three more fires",
    page: "proof/national.html#fires",
    src: `The Creek Fire (California, 2020), the East Fork Fire (Utah, 2020) and the Paddock Fire (Idaho, 2024): official perimeters from NIFC <i>WFIGS Interagency Fire Perimeters</i>, records 2020-CASNF-001391, 2020-UTASF-100340 and 2024-IDBOD-000917 (<a href="https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-interagency-fire-perimeters/about" target="_blank" rel="noopener">data-nifc.opendata.arcgis.com</a>). Hot spots: NASA FIRMS MODIS C6.1. Chosen as the fires where more room made the biggest difference: from 39, 37 and 25 pieces down to 2, 2 and 1. More room here is the setting the national test used for each region (4 km and 14 days in California; 4 km and 10 days in Utah and Idaho). My analysis: <a href="proof/national.html#fires">proof page</a>.`,
  },
  national: {
    title: "57% to 74%",
    page: "proof/national.html",
    src: `My analysis of 1,431 official US fire perimeters, 2020–2024 (NIFC <i>WFIGS Interagency Fire Perimeters</i>, <a href="https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-interagency-fire-perimeters/about" target="_blank" rel="noopener">data-nifc.opendata.arcgis.com</a>) and 565,317 NASA FIRMS MODIS C6.1 hot spots. A fire counts as correct when one group holds at least 90% of its hot spots and at least 90% of that group is that fire; the wider setting is chosen on five regions and tested on the sixth. Every fire is listed on the <a href="proof/national.html#table">proof page</a>.`,
  },
  spread: {
    title: "Five days, about 50 km",
    body: `<p>The satellites saw the fire burning for about <b>120 hours</b>, from the evening of 10 August to the evening of 15 August 2015. (It was declared contained on 23 August.)</p>
      <p>Its northernmost hot spot is about <b>50 km</b> north of the southernmost one from the first day. The map replays every detection at the hour it was seen.</p>`,
    src: `My analysis of NASA FIRMS MODIS C6.1 detections inside the official perimeter. Containment date: BLM (2016), <a href="https://www.blm.gov/sites/blm.gov/files/Program_FishandWildlife_WildllifeIdahoSodaFireESR_StatusReport.pdf" target="_blank" rel="noopener">status report</a>.`,
  },
  era5: {
    title: "The wind",
    body: `<p>The streaks follow the real wind 10 m above the ground, hour by hour, on a 5 × 5 grid over the fire, from the ERA5 reanalysis. Their speed is exaggerated so you can see them move.</p>
      <p>Over those days it blew mostly from the south and south-east.</p>`,
    src: `Hersbach, H. et al. (2020). The ERA5 global reanalysis. <i>Quarterly Journal of the Royal Meteorological Society</i> 146: 1999–2049. <a href="https://doi.org/10.1002/qj.3803" target="_blank" rel="noopener">doi:10.1002/qj.3803</a>. Accessed through the Open-Meteo historical weather API with the ERA5 model selected. <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noopener">open-meteo.com</a>`,
  },
  flight: {
    title: "The drone",
    body: `<p>On <b>30 June 2022</b>, a research team flew a small drone (a DJI Mavic 2 Pro with a 20-megapixel camera) in a criss-cross pattern <b>44 m above the ground</b>, over a strip of land on the edge of the Soda Fire.</p>
      <p>From its overlapping photos they built a single image sharp to about <b>1 cm per pixel</b>, and a 3D model of the surface. The 3D block, and every circle in the game, is made from that flight.</p>`,
    src: `Marie, V., Zaiats, A., Roser, A., Olsoy, P., Delparte, D., Wickersham, R., Caughlin, T.T. (2023). Digital aerial imagery (RGB and multispectral) from the 2015-SODA wildfire boundary near the Oregon/Idaho border USA-2022 [dataset]. University of Idaho. <a href="https://doi.org/10.7923/59M8-5S68" target="_blank" rel="noopener">doi:10.7923/59M8-5S68</a> (CC BY 4.0)`,
  },
  survey: {
    title: "How the flight is drawn",
    body: `<p>The white square is the area the drone mapped. The dataset gives the flight's height and pattern, but not where each photo was taken or how many there were, so the path here is drawn to show the pattern: passes east–west, about 20 m apart. (The real flight also flew north–south passes.)</p>
      <p>The frame under the drone is the patch of ground one photo covers from 44 m: about <b>56 × 38 m</b>, from the Mavic 2 Pro's 13.2 × 8.8 mm sensor and 10.3 mm lens. The pale strips are where its camera has already looked; they overlap many times over, which is what lets the photos be stitched and turned into 3D. The drone is drawn many times its real size, and the flight is sped up.</p>`,
    src: `Flight height and pattern: Marie et al. (2023), <a href="https://doi.org/10.7923/59M8-5S68" target="_blank" rel="noopener">doi:10.7923/59M8-5S68</a>. Camera: DJI, <i>Mavic 2 Pro specs</i> (1-inch 20 MP sensor), <a href="https://www.dji.com/mavic-2/info" target="_blank" rel="noopener">dji.com</a>.`,
  },
  sfm: {
    title: "Photos into 3D",
    body: `<p>Software finds the same small features (a rock, the tip of a shrub) in many overlapping photos. Because each photo was taken from a slightly different place, those features shift a little from one photo to the next, and the size of the shift gives their position in 3D. The method is called <b>structure from motion</b>.</p>
      <p>The research team processed the photos this way, in the open-source program OpenDroneMap. The result is one picture of the whole site, sharp to about 1 cm, and a surface model of every bump and shrub.</p>`,
    src: `Westoby, M.J., Brasington, J., Glasser, N.F., Hambrey, M.J., Reynolds, J.M. (2012). 'Structure-from-Motion' photogrammetry: a low-cost, effective tool for geoscience applications. <i>Geomorphology</i> 179: 300–314. <a href="https://doi.org/10.1016/j.geomorph.2012.08.021" target="_blank" rel="noopener">doi:10.1016/j.geomorph.2012.08.021</a>. Processing: Marie et al. (2023), <a href="https://doi.org/10.7923/59M8-5S68" target="_blank" rel="noopener">doi:10.7923/59M8-5S68</a>.`,
  },
  burnline: {
    title: "The fire line",
    body: `<p>The orange line is where the 2015 fire stopped. It is not my guess: the research team traced it from historical satellite images, and the site was chosen to straddle it, burned on one side and unburned on the other.</p>
      <p>You can see it in the drone photo itself: dense grey-green sagebrush on the unburned side, far fewer shrubs on the burned side.</p>`,
    src: `Zaiats, A., Caughlin, T.T. (2023). Low-cost UAS platforms to quantify and predict post-fire recovery in arid shrublands [dataset]. University of Idaho. <a href="https://doi.org/10.7923/96mc-a063" target="_blank" rel="noopener">doi:10.7923/96mc-a063</a> (CC BY 4.0)`,
  },
  chm: {
    title: "What the drone measures",
    body: `<p>From the overlapping photos, software rebuilds the shape of the ground and of everything on it. Subtract the bare ground from the top surface and you get the <b>height of every plant</b>: a canopy height model.</p>
      <p>Here, anything above about 20 cm glows. Shorter plants blend into the ground.</p>`,
    src: `Canopy height model from Zaiats &amp; Caughlin (2023), <a href="https://doi.org/10.7923/96mc-a063" target="_blank" rel="noopener">doi:10.7923/96mc-a063</a>. The 20 cm display threshold is mine.`,
  },
  sagebrush: {
    title: "Why young shrubs matter",
    body: `<p>Wyoming big sagebrush, the shrub that defines this landscape, is "easily killed by fire" and "does not sprout" back from its roots. It "primarily regenerates from seeds".</p>
      <p>So the small, young shrubs on burned ground are the recovery itself. Counting them tells you whether the land is coming back.</p>`,
    src: `Innes, R.J. (2019). <i>Artemisia tridentata</i> subsp. <i>wyomingensis</i>, Wyoming big sagebrush. In: Fire Effects Information System. USDA Forest Service, Rocky Mountain Research Station. <a href="https://www.fs.usda.gov/database/feis/plants/shrub/arttriw/all.html" target="_blank" rel="noopener">fs.usda.gov/database/feis</a>`,
  },
  crew: {
    title: "The field crew",
    body: `<p>People walked to small plots placed at random across the site and mapped <b>every plant</b> in them with survey-grade GPS, to about 3 cm. For each shrub they noted the species and whether it was taller or shorter than <b>25 cm</b>. Here, "young" means shorter.</p>
      <p>On the burned side there are 54 plots. Only 16 of them hold any young shrubs: <b>64</b> in all. The drone found 5 of them.</p>
      <p>The circles drawn here have a 5 m radius, which matches where the crew's mapped plants lie. The research team's papers describe the plots as 25 m², and I have not been able to reconcile the two, so this page gives counts rather than plants per hectare.</p>`,
    src: `Zaiats, A., Caughlin, T.T. (2023), field plots and plant locations. <a href="https://doi.org/10.7923/96mc-a063" target="_blank" rel="noopener">doi:10.7923/96mc-a063</a>. Circle positions adjusted as described in <a href="methods.html">How this was made</a>.`,
  },
  lookfor: {
    title: "What a young sagebrush looks like",
    body: `<p>These three are young sagebrush (shorter than 25 cm) that the field crew mapped on the burned side, cut out of the drone's own 1 cm photo where the crew recorded them. Each picture is about 52 cm across, at the photo's full 1 cm a pixel.</p>
      <p>From above, a young sagebrush is a small grey-green tuft, often on bare ground; grass tufts are yellower and spikier.</p>`,
    src: `Plant locations: Zaiats, A., Caughlin, T.T. (2023). <a href="https://doi.org/10.7923/96mc-a063" target="_blank" rel="noopener">doi:10.7923/96mc-a063</a> (circles 81, 212 and 105). Photo: Marie et al. (2023), <a href="https://doi.org/10.7923/59M8-5S68" target="_blank" rel="noopener">doi:10.7923/59M8-5S68</a>.`,
  },
  rates: {
    title: "What the drone found",
    body: `<p>A shrub counts as found when the drone's height model has a peak within 60 cm of where the crew mapped it. On the burned side: <b>78 of 123</b> big shrubs (63%) and <b>5 of 64</b> young ones (8%).</p>
      <p>This is my quick re-run of a standard method. The research team's own, more careful analysis, averaged over 10 burned sites in southwest Idaho, estimated that the drone detects <b>63%</b> of adult shrubs but only <b>13%</b> of juveniles (under 25 cm tall).</p>`,
    src: `My analysis; see <a href="methods.html">How this was made</a>. Zaiats, A., Caughlin, T.T., Cruz, J., Pilliod, D.S., Cattau, M.E., Liu, R., Rachman, R., Maliha, M., Delparte, D.M., Clare, J.D.J. (2024). Propagating observation errors to enable scalable and rigorous enumeration of plant population abundance with aerial imagery. <i>Methods in Ecology and Evolution</i> 15(11): 2074–2086. <a href="https://doi.org/10.1111/2041-210X.14421" target="_blank" rel="noopener">doi:10.1111/2041-210X.14421</a>`,
  },
  blm: {
    title: "Who looks after this land",
    body: `<p>Most of the land the Soda Fire burned is public land, managed by the <b>Bureau of Land Management</b>. Nearly 200,000 of the burned acres were sage-grouse habitat.</p>
      <p>Afterwards, the BLM seeded more than 17,000 acres by drill and planted 492,140 sagebrush and bitterbrush seedlings in the first year. With the U.S. Geological Survey it set up about 2,000 monitoring points, so that what grows back would "inform future decisions about adaptive management" and further treatment.</p>`,
    src: `Bureau of Land Management (2016). <i>Soda Fire Emergency Stabilization and Rehabilitation: status report</i>. <a href="https://www.blm.gov/sites/blm.gov/files/Program_FishandWildlife_WildllifeIdahoSodaFireESR_StatusReport.pdf" target="_blank" rel="noopener">blm.gov (PDF)</a>. Germino, M.J., Torma, P., Fisk, M., Applestein, C. (2022). Monitoring for adaptive management of burned sagebrush-steppe rangelands: addressing variability and uncertainty on the 2015 Soda Megafire. <i>Rangelands</i> 44(1): 99–110. <a href="https://doi.org/10.1016/j.rala.2021.12.002" target="_blank" rel="noopener">doi:10.1016/j.rala.2021.12.002</a>`,
  },
};

// Help, not a source: opens in the same portal, but isn't numbered or listed at the end
export const HELP = {
  ar: {
    title: "Playing in AR",
    body: `<h4>Where AR works</h4>
      <ul><li>In <b>Chrome on an Android phone or tablet</b> that supports Google Play Services for AR.</li>
        <li>Not on an iPhone, iPad or computer yet: their browsers can't open it. There, the game plays here on the screen, with the same circles.</li></ul>
      <h4>You weren't asked about AR</h4>
      <ul><li>The page only offers AR when the browser says it can do it.</li>
        <li>On Android, open the page in Chrome itself, not inside another app (such as Gmail or WhatsApp).</li>
        <li>Install or update <b>Google Play Services for AR</b> from the Play Store, update Chrome, then reload the page.</li></ul>
      <h4>AR doesn't start</h4>
      <ul><li>Allow the camera when Chrome asks. If AR can't start, the game carries on here, on the screen.</li>
        <li>Said no to the camera before? Tap the icon at the left of the address bar, then Permissions, Camera, Allow, and reload the page.</li>
        <li>Close any other app that is using the camera.</li></ul>
      <h4>The land is hard to see, or drifts</h4>
      <ul><li>The land appears in front of where the tablet points. Point it at a table or the floor.</li>
        <li>Use good light and a surface with some pattern (a wooden table, a rug); plain white or shiny ones are hard for the camera to hold on to. Move slowly.</li>
        <li>Land off to one side? Point the tablet where you want it and press <b>Bring it here</b>.</li></ul>
      <h4>Moving the land</h4>
      <ul><li><b>+</b> and <b>−</b>, or pinch: closer and further.</li>
        <li>The round pad: turn the land round, and tip it toward you or back. Two fingers twisting turn it too.</li></ul>
      <h4>Marking young shrubs</h4>
      <ul><li>Go into the green circle first: <b>Mark</b> works only there.</li>
        <li>Move the tablet until the white ring sits on a young sagebrush, and press <b>Mark</b>. When you have marked all you can see, press <b>Check</b>.</li></ul>
      <h4>Leaving AR</h4>
      <ul><li>Press <b>Exit AR</b> at any time. The game carries on here, on the screen, in the same circle.</li>
        <li>To try AR again, reload the page.</li></ul>`,
    src: `Phones and tablets that can run AR: Google, <i>ARCore supported devices</i>. <a href="https://developers.google.com/ar/devices" target="_blank" rel="noopener">developers.google.com/ar/devices</a>`,
  },
};

export function initRefs() {
  const links = [...document.querySelectorAll("a.ref")];
  const order = [];
  for (const a of links) if (!order.includes(a.dataset.ref)) order.push(a.dataset.ref);
  const num = (k) => order.indexOf(k) + 1;
  for (const a of links) {
    const k = a.dataset.ref;
    if (!REFS[k]) { console.warn("missing source", k); continue; }
    a.href = `#ref-${num(k)}`;
    a.insertAdjacentHTML("beforeend", `<sup>${num(k)}</sup>`);
  }
  document.querySelector("#reflist").innerHTML = order.filter((k) => REFS[k]).map((k) =>
    `<li id="ref-${num(k)}"><b>${REFS[k].title}.</b> ${REFS[k].src}</li>`).join("");

  const portal = document.querySelector("#portal");
  const $ = (id) => document.querySelector(id);
  let openKey = null;
  function open(k, at) {
    const r = REFS[k] || HELP[k];
    // the portal grows out of the link that was clicked
    const box = at?.getBoundingClientRect?.();
    portal.style.setProperty("--px", box ? `${box.left + box.width / 2}px` : "50%");
    portal.style.setProperty("--py", box ? `${box.top + box.height / 2}px` : "50%");
    $("#portal-n").textContent = HELP[k] ? "Help" : `Source ${num(k)} · ${r.title}`;
    const page = !!r.page;
    portal.classList.toggle("page", page);
    $("#portal-text").hidden = page;
    $("#portal-frame").hidden = !page;
    $("#portal-open").hidden = !page;
    if (page) {
      const [path, hash] = r.page.split("#");
      const url = `${path}?embed=1${hash ? `#${hash}` : ""}`;
      if ($("#portal-frame").dataset.src !== url) { $("#portal-frame").src = url; $("#portal-frame").dataset.src = url; }
      $("#portal-open").href = r.page;
    } else {
      $("#portal-title").textContent = r.title;
      $("#portal-body").innerHTML = r.body;
      $("#portal-src").innerHTML = r.src;
      $("#portal-text").scrollTop = 0;
    }
    portal.hidden = false;
    document.documentElement.style.overflow = "hidden";
    requestAnimationFrame(() => requestAnimationFrame(() => portal.classList.add("on")));
    if (!openKey) history.pushState({ portal: k }, "");
    openKey = k;
    setTimeout(() => $("#portal-close").focus({ preventScroll: true }), 300);
  }
  function close(fromHistory) {
    if (!openKey) return;
    openKey = null;
    portal.classList.remove("on");
    document.documentElement.style.overflow = "";
    setTimeout(() => { if (!openKey) portal.hidden = true; }, 700);
    if (!fromHistory && history.state?.portal) history.back();
  }
  // each claim opens its source, growing out of the link itself
  for (const a of links) a.onclick = (e) => { e.preventDefault(); e.stopImmediatePropagation(); open(a.dataset.ref, a); };
  for (const a of document.querySelectorAll("a[data-help]")) a.onclick = (e) => { e.preventDefault(); open(a.dataset.help, a); };
  $("#portal-close").onclick = () => close();
  portal.addEventListener("click", (e) => { if (e.target === portal) close(); });
  addEventListener("keydown", (e) => e.key === "Escape" && close());
  addEventListener("popstate", () => close(true));
}
