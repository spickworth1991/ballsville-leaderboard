// scripts/auto-gen.js
import fs from "fs";
import path from "path";
import axios from "axios";
import pLimit from "p-limit";
import prompts from "prompts";

// NFL season year helper:
// Jan/Feb still count as previous season; March+ counts as the new season year.
function getCurrentSeason(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1; // 1-12
  return m <= 2 ? y - 1 : y;
}

/** =================== CONSTANTS =================== */
const CONCURRENCY = 5;
const RETRIES = 3;
const MAX_WEEKS = 18;
// "current year" here means the current NFL season, not calendar year.
const CURRENT_YEAR = String(getCurrentSeason());


const BACKUP_DIR = "auto";        // outputs go here
const PLAYER_FILE = path.join(BACKUP_DIR, "sleeper_players.json");

// Per-year naming
const perYearLeaderboards = (y) => path.join(BACKUP_DIR, `leaderboards_${y}.json`);
const perYearManifest    = (y) => path.join(BACKUP_DIR, `weekly_manifest_${y}.json`);
const perYearPart        = (y, i) => path.join(BACKUP_DIR, `weekly_rosters_${y}_part${i}.json`);

const MAX_CHUNK_SIZE = 23 * 1024 * 1024; // ~23 MiB headroom < Cloudflare 25 MiB

const limit = pLimit(CONCURRENCY);
const axiosInstance = axios.create();

// ✅ Combined maps for multiple leaderboards
const LEAGUE_MAP = {
  "2025": {
    big_game: {
      name: "2025 Big Game",
      divisions: {
        "The Boys": [
          "1253784223572054016",
          "1253784097361248256",
          "1253783958911467520",
          "1253783829345210368",
          "1253783490437066753",
          "1253783230419582976",
          "1253783033773838336",
          "1253782672942043136"
        ],
        "Character Unlocks": [
          "1248759493509001216",
          "1248759399116185600",
          "1248759321198604288",
          "1248759237685825536",
          "1248759094936870912",
          "1248758997247332352",
          "1248758889822814208",
          "1248758806159052800"
        ],
        "Transformers": [
          "1245939198322544640",
          "1245939058090192896",
          "1245938950132998144",
          "1245938807111426048",
          "1245938520757915648",
          "1245938351500963841",
          "1245938209041416192",
          "1245938023556730880"
        ],
        "Pokemon": [
          "1241186240582131712",
          "1241186167072763904",
          "1241186039402332160",
          "1241185929842937856",
          "1241185833717878784",
          "1241185729577484288",
          "1241185496642637824",
          "1241185404669927424"
        ],
        "The ALL-STARS": [
          "1240082544733470720",
          "1240082455893901312",
          "1240082381742813184",
          "1240082270786695168",
          "1240082146673049600",
          "1240082057686683648",
          "1240081924945346560",
          "1236751178050568192"
        ],
        "Wizards and Warriors": [
          "1237598618643337216",
          "1237598399469977600",
          "1237598175703867393",
          "1237598033231757312",
          "1237597756629987328",
          "1237597551729848321",
          "1237597386453295104",
          "1237596915722354688"
        ],
        "The Heroes": [
          "1235975021411704832",
          "1235974950532161536",
          "1235974863114469376",
          "1235974768860082176",
          "1235974680179908608",
          "1235974574781235200",
          "1235974467520303104",
          "1235974358736838656"
        ],
        "The Villains": [
          "1233583711300104192",
          "1233583574993608704",
          "1233583369338486784",
          "1233583172818583552",
          "1233582893779914752",
          "1233582758832386048",
          "1233582625105383424",
          "1233582422252081152"
        ],
        "Gamer Realms": [
          "1231279725565972480",
          "1231279535404613632",
          "1231279411060289536",
          "1231279270848901120",
          "1231278695730130944",
          "1231278520894763008",
          "1231278376124157952",
          "1231278150952960000"
        ],
        "The Avengers": [
          "1229235507087556608",
          "1229235325600026624",
          "1229235149107904512",
          "1229234920463802368",
          "1229234429591818240",
          "1229234146241429504",
          "1229234040515596288",
          "1229234687747051521"
        ],
        "Star Wars": [
          "1226611943922466816",
          "1226611763462549504",
          "1226611529588150272",
          "1226611356535365632",
          "1226610902124482560",
          "1226610663971885056",
          "1226610355413729280",
          "1226608580069687296"
        ],
        "Game of Thrones": [
          "1223841783251738624",
          "1223841691383902208",
          "1223841609146175488",
          "1223841523267801088",
          "1223841415503544320",
          "1223841322201255936",
          "1223841175513874432",
          "1223841048342564864"
        ]
      }
    },

    mini_game: {
      name: "2025 Mini Game",
      divisions: {
        "Division 400s": [
          "1211877557809463296",
          "1211877422299873280",
          "1211877319031926784",
          "1211877193861308416",
          "1211877061417775105",
          "1211876924498919424",
          "1211876342157557760",
          "1211876246275768320",
          "1211876146774290432",
          "1211876028306182144"
        ],
        "Division 300s": [
          "1203413320967667712",
          "1203413200247205888",
          "1203413085184860160",
          "1203412975302479872",
          "1203412646611660800",
          "1203412353681477632",
          "1203412222689157120",
          "1203412032636850176",
          "1203411785261006848",
          "1203411633628528640"
        ],
        "Division 200s": [
          "1197791545584001024",
          "1197791409764048896",
          "1197791127445446656",
          "1197790908414689280",
          "1197790768404643854",
          "1197790562833420288",
          "1197790405148557312",
          "1197790201145987072",
          "1197789969783980032",
          "1197395516766289920"
        ],
        "Division 100s": [
          "1193787275249246208",
          "1193787064344080384",
          "1193786911548526592",
          "1193786714844381184",
          "1193786499282890752",
          "1193786240147550208",
          "1193785541374545920",
          "1193785376887574528",
          "1193784925865218048",
          "1193784514820370432"
        ]
      }
    },

    redraft_2025: {
        name: "2025 Redraft",
        divisions: {
        "All": [
          "1255288335568490496",
          "1255288192051990528",
          "1255287978423504896",
          "1255287803600715776",
          "1255287431989575680",
          "1255287171217113089",
          "1255286216937459712",
          "1255285810786209792",
          "1255285320170090496",
          "1255285048068812802",
          "1260058816246972419",
          "1260061892144013312",
          "1260061737114152960",
          "1260061563801317376",
          "1260061342925082624",
          "1260061213673390080",
          "1260061038875770880",
          "1260060871627907072",
          "1260059097022087169",
          "1260058202859393024",

        ]
      }
    },
    gauntlet: {
      name: "2025 Gauntlet",
      divisions: {
        "Romans": [
          "1248763372128706560",
          "1248762972466073600",
          "1231418044421521408",
          "1231417737801105408",
          "1218702306590072832",
          "1218702136909512705",
          "1212974613181513728",
          "1212974482948378624"
        ],
        "Greeks": [
          "1248762436618567680",
          "1248761188276240384",
          "1231417454689779712",
          "1231417314214154240",
          "1218701899885191168",
          "1218701807333675008",
          "1212974238936350721",
          "1212974099479941120"
        ],
        "Egyptians": [
          "1248760700227047424",
          "1248759939321577472",
          "1231417137134841856",
          "1231416906401984512",
          "1218701651540459520",
          "1218701332836265984",
          "1212973917774290944",
          "1212967422475112448"
        ]
      }
    },

    dynasty: {
      name: "2025 Dynasty",
      divisions: {
        "Heroes of Dynasty": [
          "1211843117481730048",
          "1211843011340668928",
          "1211842907326136320",
          "1208194980154200081",
          "1201362833741185024",
          "1201362405729251328",
          "1195877478497783808",
          "1195877324013191168",
          "1193232605812826112",
          "1193089764030472192",
          "1189763370874486784",
          "1189763229441921024",
          "1189763145483796480",
          "1189762980392165376",
          "1189426381956354048",
          "1189763535369687040",
          ],

        "Dragons of Dynasty": [
          "1183218710324412416",
          "1183216824196034560",
          "1183215347088457728",
          "1183212007243186176",
          "1183209678813143040",
          "1183207209777987584",
          "1183205535590719488",
          "1183192311432261632",
          "1183190574903320576",
          "1183188650580836352",
          "1183184007500521472",
          "1183181430795624448",
          "1183178974482612224",
          "1183165958661529600",
          "1183163017793847296",
          "1183160615865257984"
        ]
      }
    }
  },

  "2024": {
    dynasty: {
      name: "2024 Dynasty",
      divisions: {
        "Dynasty Leagues": [
          "1048724101956759552",
          "1048816365022470144",
          "1049013976874565632",
          "1049167929297723392",
          "1056426042719637504",
          "1056674173751250944",
          "1057068627473616896",
          "1058622402705436672",
          "1059232900375216128",
          "1059369854685294592",
          "1101337091729977344",
          "1101337456936439808",
          "1103879314824585216",
          "1104456170539982848",
          "1104474138405683200",
          "1126351293326544896"
        ]
      }
    },

    big_game: {
      name: "2024 Big Game",
      divisions: {
        "The Boys": [
          "1123827987570470912",
          "1123827803780186112",
          "1123827724960866304",
          "1123827660926406656",
          "1123827573617790976",
          "1123827490755031040",
          "1123827419460358144",
          "1123826825777467392"
        ],
        "Character Unlocks": [
          "1120745038469898240",
          "1120744950632632320",
          "1120744871058325504",
          "1120744703345000448",
          "1120744628711464960",
          "1120744525225459712",
          "1120744406925012992",
          "1120744290046541824"
        ],
        "Transformers": [
          "1109161129844101120",
          "1109161054732509184",
          "1109160979520184320",
          "1109160915569790976",
          "1109160492251127808",
          "1109160423368114176",
          "1109160351624515584",
          "1109160258435620864"
        ],
        "Pokemon": [
          "1106606152273727488",
          "1106606009629392896",
          "1106605854230482944",
          "1106605702665302016",
          "1106604722338979840",
          "1106604579740983296",
          "1106604289545482240",
          "1106604184754995200"
        ],
        "The ALL-STARS": [
          "1102374857863458816",
          "1102374736048275456",
          "1102374644071370752",
          "1102374549376720896",
          "1102374448537141248",
          "1102374353548828672",
          "1088645433498439680",
          "1081753145581162496"
        ],
        "Wizards and Warriors": [
          "1100462770123812864",
          "1100462557040660480",
          "1100462473905364992",
          "1100462329713479680",
          "1100462231411724288",
          "1100462153955418112",
          "1100462033612464128",
          "1100461937919348736"
        ],
        "The Heroes": [
          "1097054393586876416",
          "1097054293028331520",
          "1097054186648264704",
          "1097054091819319296",
          "1097053931659767808",
          "1097053837711527936",
          "1097053733990666240",
          "1097053655536066560"
        ],
        "The Villains": [
          "1094775022285107200",
          "1094774938206117888",
          "1094774852499759104",
          "1094774756039106560",
          "1094774685465763840",
          "1094774609586569216",
          "1094774520990277632",
          "1094774407458836480"
        ],
        "Gamer Realms": [
          "1092893132527665152",
          "1092893037111468032",
          "1092892947454087168",
          "1092892689089093632",
          "1092892599247081472",
          "1092892469240352768",
          "1092892287249661952",
          "1092892096933076992"
        ],
        "The Avengers": [
          "1090889545148665856",
          "1090889465624707072",
          "1090889386742325248",
          "1090889279007440896",
          "1090889181473189888",
          "1090889076716158976",
          "1090888946046820352",
          "1090888770674688000"
        ],
        "Star Wars": [
          "1087967573192347648",
          "1087967532830502912",
          "1087967486353502208",
          "1087967410218520576",
          "1087966732775428096",
          "1087965448508989440",
          "1087965394754793472",
          "1087965328610586624"
        ],
        "Game of Thrones": [
          "1078876267329482752",
          "1078876226141376512",
          "1078876173062586368",
          "1078876134856581120",
          "1078875929419698176",
          "1078875880124039168",
          "1078875816169324544",
          "1078875756106878976"
        ]
      }
    },

    mini_game: {
      name: "2024 Mini Game",
      divisions: {
        "Division 400s": [
          "1073400683329626112",
          "1073400568598634496",
          "1073400452538105856",
          "1073043826694119424",
          "1073043745089724416",
          "1073043643453284352",
          "1072399897200009216",
          "1072398487989485568",
          "1072398277724721152",
          "1072398149798490112"
        ],
        "Division 300s": [
          "1070581685659582464",
          "1070581544504426496",
          "1070581446688997376",
          "1070581270146621440",
          "1070522179030323200",
          "1069726832582291456",
          "1069726503388139520",
          "1069726435675426816",
          "1069725978546528256",
          "1069725905272111104"
        ],
        "Division 200s": [
          "1068037348614598656",
          "1068037270491484160",
          "1068037204884267008",
          "1068037126656184320",
          "1067531836819107840",
          "1066628223301251072",
          "1066627744857022464",
          "1066553981574496256",
          "1066552445989371904",
          "1065786845549748224"
        ],
        "Division 100s": [
          "1065347348668203008",
          "1065346719510142976",
          "1065325446180548608",
          "1064463087685799936",
          "1063182022790819840",
          "1063169253563625472",
          "1062933033910689792",
          "1062197844603387904",
          "1062181042263511040",
          "1061534392134344704"
        ]
      }
    },

    redraft: {
      name: "2024 Redraft",
      divisions: {
        "High Tier": [
          "1118637578028285952",
          "1118637496344186880",
          "1118325660805705728",
          "1049771874726744064",
          "1049771551287676928",
          "1049768407602036736",
          "1049768201309167616",
          "1049767991623626752",
          "1049766980884590592",
          "1049766361402511360"
        ],
        "Mid Tier": [
          "1118637390748303360",
          "1049774069039955968",
          "1049774029626195968",
          "1049773996243689472",
          "1049773289264480256",
          "1049773246419480576",
          "1049773189305692160",
          "1049773145559482368",
          "1049773102924410880",
          "1049772301636067328"
        ],
        "Low Tier": [
          "1118571787685613568",
          "1118326982288277504",
          "1049776813788291072",
          "1049776758406848512",
          "1049776727305830400",
          "1049776337101291520",
          "1049776280344514560",
          "1049776237184716800",
          "1049776188291534848",
          "1049774988112576512"
        ]
      }
    }
  }
};

if (typeof LEAGUE_MAP === "undefined") {
  console.error("❌ LEAGUE_MAP is missing. Paste your existing LEAGUE_MAP into this file.");
  process.exit(1);
}

/** =================== HELPERS =================== */
// Optional env overrides for CI / automation
const ENV_YEARS = process.env.LEADERBOARD_YEARS
  ? process.env.LEADERBOARD_YEARS.split(",").map(s => s.trim()).filter(Boolean)
  : null;

// If unset, we'll default to true in CI mode
const ENV_USE_CACHED_PLAYERS = process.env.USE_CACHED_PLAYERS;

// ---- BEST BALL HELPERS -------------------------------------------------
const normId = (x) => (x == null ? null : String(x).trim());

function playerPos(playersDB, id) {
  const p = playersDB[id] || {};
  // Sleeper usually has both; position is fine
  return String(p.position || (p.fantasy_positions && p.fantasy_positions[0]) || '').toUpperCase();
}

function computeBestBallLineup(players_points = {}, playersDB) {
  // Build candidate list from all players that scored (0 allowed; we’ll sort anyway)
  const entries = Object.entries(players_points).map(([rawId, pts]) => {
    const id = normId(rawId);
    const pos = playerPos(playersDB, id);
    return {
      id,
      name: (playersDB[id]?.full_name) || id,
      pos,
      points: Number(pts ?? 0),
    };
  });

  // Partition and sort desc
  const by = (p) => entries.filter(e => e.pos === p).sort((a,b)=> b.points - a.points);
  const QB = by('QB'), RB = by('RB'), WR = by('WR'), TE = by('TE');

  const picked = new Set();
  const starters = [];

  const take = (arr, n, slot) => {
    for (let i=0; i<arr.length && n>0; i++) {
      const e = arr[i];
      if (!e.id || picked.has(e.id)) continue;
      picked.add(e.id);
      starters.push({ ...e, slot });
      n--;
    }
  };

  // Base requirements
  take(QB, 1, 'QB');
  take(RB, 2, 'RB');
  take(WR, 3, 'WR');
  take(TE, 1, 'TE');

  // FLEX x2 from remaining RB/WR/TE
  const flexPool = entries
    .filter(e => !picked.has(e.id) && (e.pos === 'RB' || e.pos === 'WR' || e.pos === 'TE'))
    .sort((a,b)=> b.points - a.points);
  take(flexPool, 2, 'FLEX');

  // SF x1 from remaining QB/RB/WR/TE
  const sfPool = entries
    .filter(e => !picked.has(e.id) && (e.pos === 'QB' || e.pos === 'RB' || e.pos === 'WR' || e.pos === 'TE'))
    .sort((a,b)=> b.points - a.points);
  take(sfPool, 1, 'SF');

  // Bench = everything not picked
  const bench = entries
    .filter(e => e.id && !picked.has(e.id))
    .map(e => ({ id: e.id, name: e.name, points: e.points, pos: e.pos }));

  // Order starters nicely
  const order = { QB:0, RB:1, WR:2, TE:3, FLEX:4, SF:5 };
  starters.sort((a,b) => (order[a.slot]-order[b.slot]) || (b.points-a.points));

  return {
    starters: starters.map(e => ({ id:e.id, name:e.name, points:e.points, pos:e.pos, slot:e.slot })),
    bench,
    total: Number(starters.reduce((s,e)=> s + Number(e.points||0), 0).toFixed(2)),
  };
}

// Always minify exactly how we measure size
const stringifyMin = (obj) => JSON.stringify(obj);
const sizeOf       = (obj) => Buffer.byteLength(stringifyMin(obj), "utf8");

function writeJSONMin(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stringifyMin(obj));
}

function readJSONSafe(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch { return fallback; }
}

async function fetchWithRetry(url, retries = RETRIES) {
  for (let i = 0; i < retries; i++) {
    try { return (await axiosInstance.get(url)).data; }
    catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(res => setTimeout(res, 500 * (i + 1)));
    }
  }
}

function findLatestWeek(matchupsByWeek) {
  const weeks = Object.keys(matchupsByWeek).map(Number);
  return weeks.length ? Math.max(...weeks) : null;
}

function mergeDeep(target, src) {
  if (typeof target !== "object" || target === null) return src;
  if (typeof src !== "object" || src === null) return target;
  const out = { ...target };
  for (const [k, v] of Object.entries(src)) {
    out[k] = k in out ? mergeDeep(out[k], v) : v;
  }
  return out;
}

// ============== Stable division/league sorting for manifests ==============
// Ensures downstream UIs get consistent ordering without doing extra work at runtime.
// Patterns:
// - Big Game: D8L1 or (D9L12) (parens optional)
// - Mini Leagues: 101-110, 201-210, ... (hundreds digit => division, remainder => league)
// - Redraft: #1, #2, ...
function leagueSortKey(leagueName) {
  const s = String(leagueName || "").trim();

  // Big Game: allow "D8L1" with optional parens and optional spaces.
  let m = s.match(/^\(?\s*D\s*(\d+)\s*L\s*(\d+)\s*\)?/i);
  if (m) {
    return { kind: 0, a: Number(m[1]) || 0, b: Number(m[2]) || 0, t: s.toLowerCase() };
  }

  // Mini Leagues: 101, 210, 305, ...
  m = s.match(/^(\d{3})\b/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) {
      const div = Math.floor(n / 100);
      const lg = n % 100;
      return { kind: 1, a: div, b: lg, t: s.toLowerCase() };
    }
  }

  // Redraft: #1, #2, ...
  m = s.match(/^#\s*(\d+)\b/);
  if (m) {
    return { kind: 2, a: Number(m[1]) || 0, b: 0, t: s.toLowerCase() };
  }

  // Fallback alphabetical
  return { kind: 9, a: 0, b: 0, t: s.toLowerCase() };
}

function sortLeagueNamesInDivisions(leagueNamesByDivision) {
  for (const div of Object.keys(leagueNamesByDivision || {})) {
    const arr = Array.isArray(leagueNamesByDivision[div]) ? leagueNamesByDivision[div] : [];
    arr.sort((a, b) => {
      const ka = leagueSortKey(a);
      const kb = leagueSortKey(b);
      if (ka.kind !== kb.kind) return ka.kind - kb.kind;
      if (ka.a !== kb.a) return ka.a - kb.a;
      if (ka.b !== kb.b) return ka.b - kb.b;
      return ka.t.localeCompare(kb.t);
    });
    leagueNamesByDivision[div] = arr;
  }
  return leagueNamesByDivision;
}

/** ============== Sleeper players DB ============== */
async function getSleeperPlayers(useCached) {
  if (useCached && fs.existsSync(PLAYER_FILE)) {
    console.log("📦 Using cached Sleeper players:", PLAYER_FILE);
    return readJSONSafe(PLAYER_FILE, {});
  }
  console.log("⬇️  Fetching Sleeper player DB...");
  const data = await fetchWithRetry("https://api.sleeper.app/v1/players/nfl");
  writeJSONMin(PLAYER_FILE, data);
  return data;
}

/** ============== Per-league processing ============== */
let completed = 0;
function logProgress(totalLeagues, msg) {
  completed++;
  console.log(`[${completed}/${totalLeagues}] ${msg}`);
}

async function processLeague(leagueId, division, playersDB, totalLeagues, isBestBall) {
  const baseUrl = `https://api.sleeper.app/v1/league/${leagueId}`;
  const leagueInfo = await fetchWithRetry(baseUrl);
  const leagueName = leagueInfo.name;
  logProgress(totalLeagues, `Processing ${leagueName} (${division})`);

  const users   = await fetchWithRetry(`${baseUrl}/users`);
  const rosters = await fetchWithRetry(`${baseUrl}/rosters`);
  const userMap = {};
  users.forEach(u => (userMap[u.user_id] = u.display_name));
  const rosterMap = {};
  rosters.forEach(r => (rosterMap[r.roster_id] = r.owner_id));

  const drafts = await fetchWithRetry(`${baseUrl}/drafts`);
  const draftId = drafts?.[0]?.draft_id;
  const draftDetails = draftId ? await fetchWithRetry(`https://api.sleeper.app/v1/draft/${draftId}`) : [];
  const draftSlotMap = {};
  draftDetails?.draft_order &&
    Object.entries(draftDetails.draft_order).forEach(([userId, slot]) => (draftSlotMap[userId] = slot));

  // Load all available weeks
  const matchupsByWeek = {};
  for (let week = 1; week <= MAX_WEEKS; week++) {
    const matchups = await fetchWithRetry(`${baseUrl}/matchups/${week}`);
    if (!matchups || !matchups.length) break;
    matchupsByWeek[week] = matchups;
  }

  const owners = [];
  const weeklyRosters = {};
  const lastNonZeroWeekByOwner = {};

  // Helper for non-best-ball modes: consistent starter points fallback
  const starterPts = (m, i) => {
    const id = normId((m.starters || [])[i]);
    const sp = m.starters_points?.[i];
    const fallback = id ? m.players_points?.[id] : 0;
    return Number(sp ?? fallback ?? 0);
  };

  // Build weekly rosters
  for (const [weekStr, matchups] of Object.entries(matchupsByWeek)) {
    const week = Number(weekStr);
    weeklyRosters[week] = [];

    matchups.forEach(m => {
      const ownerId = rosterMap[m.roster_id];
      if (!ownerId) return;
      const ownerName = userMap[ownerId];

      let starters, bench, weekTotal;

      if (isBestBall) {
        const bb = computeBestBallLineup(m.players_points || {}, playersDB);
        starters = bb.starters;
        bench = bb.bench;
        weekTotal = bb.total;
      } else {
        // Classic: take Sleeper "starters" with fallback to players_points, bench = rest
        const starterIds = new Set((m.starters || []).map(normId).filter(Boolean));
        starters = (m.starters || [])
          .map((raw, i) => {
            const id = normId(raw);
            if (!id) return null;
            const points = starterPts(m, i);
            return { id, name: (playersDB[id]?.full_name) || id, points };
          })
          .filter(Boolean);

        bench = Object.entries(m.players_points || {})
          .map(([pid, pts]) => [normId(pid), Number(pts ?? 0)])
          .filter(([pid]) => pid && !starterIds.has(pid))
          .map(([pid, pts]) => ({ id: pid, name: (playersDB[pid]?.full_name) || pid, points: pts }));

        weekTotal = Number(starters.reduce((s,p)=> s + Number(p.points||0), 0).toFixed(2));
      }

      weeklyRosters[week].push({ ownerName, starters, bench });

      if (weekTotal > 0) {
        if (!lastNonZeroWeekByOwner[ownerName] || week > lastNonZeroWeekByOwner[ownerName]) {
          lastNonZeroWeekByOwner[ownerName] = week;
        }
      }
    });
  }

  // Build owners + weekly totals map
  Object.keys(matchupsByWeek).forEach(weekStr => {
    const week = Number(weekStr);
    matchupsByWeek[week].forEach(m => {
      const ownerId = rosterMap[m.roster_id];
      if (!ownerId) return;
      const ownerName = userMap[ownerId];

      let pts;
      if (isBestBall) {
        const bb = computeBestBallLineup(m.players_points || {}, playersDB);
        pts = bb.total;
      } else {
        pts = (m.starters || []).reduce((sum, _, i) => sum + starterPts(m, i), 0);
      }

      let existing = owners.find(o => o.ownerName === ownerName);
      if (!existing) {
        existing = {
          ownerName,
          leagueName,
          division,
          draftSlot: draftSlotMap[ownerId] || null,
          weekly: {},
          total: 0,
        };
        owners.push(existing);
      }
      existing.weekly[week] = Number(pts.toFixed(2));
    });
  });

  // ✅ Always compute season total from the sum of weekly points (keeps data fresh between Sleeper rollups)
  owners.forEach(o => {
    const weeklySum = Object.values(o.weekly || {}).reduce((a, b) => a + Number(b || 0), 0);
    o.total = Number(weeklySum.toFixed(2));
  });

  // latestRoster per owner (for modal) = latest *non-zero* week (fallback: latest with data)
  const latestWeekWithData = Object.keys(matchupsByWeek).map(Number).sort((a,b)=>b-a)[0] || null;

  owners.forEach(owner => {
    const targetWeek = lastNonZeroWeekByOwner[owner.ownerName] ?? latestWeekWithData;
    if (!targetWeek) return;

    const m = (matchupsByWeek[targetWeek] || [])
      .find(mm => userMap[rosterMap[mm.roster_id]] === owner.ownerName);
    if (!m) return;

    let starters, bench;
    if (isBestBall) {
      const bb = computeBestBallLineup(m.players_points || {}, playersDB);
      starters = bb.starters;
      bench = bb.bench;
    } else {
      const starterIds = new Set((m.starters || []).map(normId).filter(Boolean));
      starters = (m.starters || [])
        .map((raw, i) => {
          const id = normId(raw);
          if (!id) return null;
          const points = starterPts(m, i);
          return { id, name: (playersDB[id]?.full_name) || id, points };
        })
        .filter(Boolean);
      bench = Object.entries(m.players_points || {})
        .map(([pid, pts]) => [normId(pid), Number(pts ?? 0)])
        .filter(([pid]) => pid && !starterIds.has(pid))
        .map(([pid, pts]) => ({ id: pid, name: (playersDB[pid]?.full_name) || pid, points: pts }));
    }

    owner.latestRoster = { week: targetWeek, starters, bench };
  });

  return { leagueName, owners, weeklyRosters };
}




/** ============== Per-year chunk writer ============== */
function makeYearChunkWriter(year) {
  let idx = 1;
  let current = {};
  let size = 0;
  const writtenParts = [];

  function writePart() {
    const file = perYearPart(year, idx);
    writeJSONMin(file, current);
    writtenParts.push(path.basename(file));
    idx++;
    current = {};
    size = 0;
  }

  function addPayload(obj) {
    const bytes = sizeOf(obj);
    if (size > 0 && size + bytes > MAX_CHUNK_SIZE) writePart();
    current = mergeDeep(current, obj);
    size += bytes;
    if (size >= MAX_CHUNK_SIZE) writePart();
  }

  function finalize() {
    if (Object.keys(current).length) writePart();
    const manifest = { parts: writtenParts };
    writeJSONMin(perYearManifest(year), manifest);
    return writtenParts;
  }

  return { addPayload, finalize };
}

/** ============== CLEANUP (selected years only) ============== */
function removeYearFiles(year) {
  if (!fs.existsSync(BACKUP_DIR)) return;
  fs.readdirSync(BACKUP_DIR).forEach(f => {
    if (f === `leaderboards_${year}.json`) fs.unlinkSync(path.join(BACKUP_DIR, f));
    if (f === `weekly_manifest_${year}.json`) fs.unlinkSync(path.join(BACKUP_DIR, f));
    if (new RegExp(`^weekly_rosters_${year}_part\\d+\\.json$`).test(f)) {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
    }
  });
}

/** ============== MAIN ============== */
async function main() {
  let SELECTED_YEARS;
  let USE_CACHED_PLAYERS;

  // 🔹 Non-interactive mode for CI / automation
  if (ENV_YEARS && ENV_YEARS.length) {
    SELECTED_YEARS = ENV_YEARS;
    // default to true if not explicitly set
    USE_CACHED_PLAYERS =
      ENV_USE_CACHED_PLAYERS === undefined
        ? true
        : ENV_USE_CACHED_PLAYERS === "true";

    console.log(
      `⚙️  Non-interactive mode: years = ${SELECTED_YEARS.join(
        ", "
      )}, useCachedPlayers = ${USE_CACHED_PLAYERS}`
    );
  } else {
    // 🔹 Local interactive mode: default to "current season + 3 back".
    // This keeps the prompt clean while still letting you add more years to LEAGUE_MAP later.
    const defaultYears = [
      String(getCurrentSeason()),
      String(getCurrentSeason() - 1),
      String(getCurrentSeason() - 2),
      String(getCurrentSeason() - 3),
    ];

    const availableYears = Object.keys(LEAGUE_MAP).map(String);
    const narrowed = defaultYears.filter((y) => availableYears.includes(y));
    const yearsForPrompt = narrowed.length ? narrowed : availableYears;

    const yearChoices = yearsForPrompt
      .slice()
      .sort()
      .map((y) => ({ title: y, value: y }));

    // Select all shown years by default
    const initialYears = yearChoices.map((_, i) => i);

    const ans = await prompts(
      [
        {
          type: "multiselect",
          name: "years",
          message: "Select year(s) to update",
          hint: "Space = toggle, Enter = confirm",
          choices: yearChoices,
          initial: initialYears,
          validate: (v) => (v.length ? true : "Pick at least one year"),
        },
        {
          type: "toggle",
          name: "useCachedPlayers",
          message: "Use cached Sleeper players if available?",
          initial: true,
          active: "Yes",
          inactive: "No",
        },
      ],
      {
        onCancel: () => {
          console.log("Cancelled.");
          process.exit(0);
        },
      }
    );

    SELECTED_YEARS = ans.years;
    USE_CACHED_PLAYERS = ans.useCachedPlayers;
  }

  const playersDB = await getSleeperPlayers(USE_CACHED_PLAYERS);

  const totalLeagues = SELECTED_YEARS
    .flatMap((y) => Object.values(LEAGUE_MAP[y] || {}))
    .flatMap((obj) => Object.values(obj.divisions || {}).flat()).length;
  completed = 0;

  for (const year of SELECTED_YEARS) {
    console.log(`\n🧹 Clearing existing per-year files for ${year}…`);
    removeYearFiles(year);

    const weeklyData = {}; // { [category]: { [leagueName]: weeklyRosters } }
    const fullYear = {}; // { [category]: {...} }

    const categories = LEAGUE_MAP[year] || {};
    for (const [category, details] of Object.entries(categories)) {
      const isBestBall = category === "big_game" || category === "mini_game";

      const allResults = [];
      const weeklyCategoryData = {};
      const leagueNamesByDivision = {};

      for (const [division, leagues] of Object.entries(details.divisions)) {
        leagueNamesByDivision[division] = [];
        await Promise.all(
          leagues.map((leagueId) =>
            limit(async () => {
              const result = await processLeague(
                leagueId,
                division,
                playersDB,
                totalLeagues,
                isBestBall
              );
              leagueNamesByDivision[division].push(result.leagueName);
              allResults.push(...result.owners);
              weeklyCategoryData[result.leagueName] = result.weeklyRosters;
            })
          )
        );
      }

      // ✅ Stable ordering for league lists inside divisions.
      // (Big Game: D#L#, Mini: 101/201..., Redraft: #1/#2...)
      sortLeagueNamesInDivisions(leagueNamesByDivision);

      // ✅ Stable ordering for the owners list (prevents "random" ordering due to concurrency).
      const divisionOrder = Object.keys(details.divisions || {});
      const divisionIndex = new Map(divisionOrder.map((d, i) => [d, i]));
      allResults.sort((a, b) => {
        const da = divisionIndex.has(a.division) ? divisionIndex.get(a.division) : 999;
        const db = divisionIndex.has(b.division) ? divisionIndex.get(b.division) : 999;
        if (da !== db) return da - db;

        const ka = leagueSortKey(a.leagueName);
        const kb = leagueSortKey(b.leagueName);
        if (ka.kind !== kb.kind) return ka.kind - kb.kind;
        if (ka.a !== kb.a) return ka.a - kb.a;
        if (ka.b !== kb.b) return ka.b - kb.b;
        if (ka.t !== kb.t) return ka.t.localeCompare(kb.t);

        const ta = Number(a.total || 0);
        const tb = Number(b.total || 0);
        if (ta !== tb) return tb - ta; // total desc

        return String(a.ownerName || "").localeCompare(String(b.ownerName || ""));
      });

      const weeks = [
        ...new Set(allResults.flatMap((o) => Object.keys(o.weekly))),
      ]
        .map(Number)
        .sort((a, b) => a - b);

      const catPayload = {
        name: details.name,
        weeks,
        owners: allResults,
        divisions: Object.keys(details.divisions),
        leaguesByDivision: leagueNamesByDivision,
      };

      if (String(year) === CURRENT_YEAR) {
        catPayload.updatedAt = new Date().toISOString();
      }

      fullYear[category] = catPayload;
      weeklyData[category] = weeklyCategoryData;
    }

    // Per-year leaderboards file: { "2025": { big_game: {...}, ... } }
    writeJSONMin(perYearLeaderboards(year), { [year]: fullYear });
    console.log(`💾 Wrote leaderboards_${year}.json`);

    // Chunk per-year weekly data into weekly_rosters_${year}_part*.json
    const chunker = makeYearChunkWriter(year);
    for (const [category, catData] of Object.entries(weeklyData)) {
      const catPayload = { [year]: { [category]: catData } };
      const catBytes = sizeOf(catPayload);

      if (catBytes <= MAX_CHUNK_SIZE) {
        chunker.addPayload(catPayload);
      } else {
        let bucket = {};
        let bucketSize = 0;

        const flush = () => {
          if (!Object.keys(bucket).length) return;
          chunker.addPayload(bucket);
          bucket = {};
          bucketSize = 0;
        };

        for (const [leagueName, leagueObj] of Object.entries(catData)) {
          const leaguePayload = {
            [year]: { [category]: { [leagueName]: leagueObj } },
          };
          const lb = sizeOf(leaguePayload);

          if (lb > MAX_CHUNK_SIZE) {
            flush();
            chunker.addPayload(leaguePayload);
            continue;
          }
          if (bucketSize + lb > MAX_CHUNK_SIZE && bucketSize > 0) flush();
          bucket = mergeDeep(bucket, leaguePayload);
          bucketSize += lb;
        }
        flush();
      }
    }

    const parts = chunker.finalize();
    console.log(
      `🧭 Wrote weekly_manifest_${year}.json with ${parts.length} part(s)`
    );
  }

  console.log("\n✅ Done (per-year only). Upload the year files you rebuilt.");
}


main().catch(e => {
  console.error(e);
  process.exit(1);
});
