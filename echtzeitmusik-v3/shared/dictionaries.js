// ═══════════════════════════════════════════════════════════════════════════
//  echtzeitmusik · dictionaries library
//  ---------------------------------------------------------------------------
//  Single source of truth for every word list the parser relies on. Split out
//  of parser.js so data lives apart from logic, duplicates are removed, and the
//  same tables are shared identically by the popup, analysis page, catalogue,
//  and the background service worker (via importScripts).
//
//  Load order matters: this file must be included BEFORE parser.js in every
//  HTML page and first in the service worker's importScripts() list, because
//  parser.js reads these globals at definition time.
//
//  All lookups are lower-cased and diacritic-folded through `foldDiacritics`
//  (see below) unless noted, so entries here are stored folded/lower-case.
// ═══════════════════════════════════════════════════════════════════════════

// Fold diacritics + German umlauts to plain ASCII lower-case for tolerant
// matching ("Neukölln" → "neukolln", "Åke" → "ake", Turkish "ı" → "i").
function foldDiacritics(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip combining accents
    .replace(/ß/g, 'ss')
    .replace(/ı/g, 'i')                 // Turkish dotless i
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/œ/g, 'oe')
    .replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/þ/g, 'th');
}

// ── Connector particles allowed inside multi-word person names ──────────────
// e.g. "van", "de", "von" in "Ludwig van Beethoven", "Rieko de la Cruz".
const CONNECTORS = new Set([
  'de', 'van', 'von', 'der', 'den', 'dem', 'des', 'la', 'le', 'da', 'del',
  'dos', 'du', 'di', 'el', 'las', 'los', 'al', 'il', 'lo', 'gli',
  'mac', 'mc', 'san', 'santa', 'santo',
  'of', 'y', 'st', 'bin', 'ben', 'abd', 'abu', 'al-',
]);

// ── Noise words ────────────────────────────────────────────────────────────
// Generic descriptors, roles, formats, gear and filler that must never be
// treated as (part of) an artist name. Stored diacritic-folded/lower-case.
const NOISE_WORDS = new Set([
  // Performance formats
  'online', 'live', 'solo', 'duo', 'trio', 'quartet', 'quintet', 'sextet',
  'quartett', 'quintett', 'quartette', 'quintette',
  'project', 'ensemble', 'orchestra', 'group', 'band', 'collective',
  'present', 'presents', 'special', 'guest', 'guests', 'featuring',
  // German function words
  'im', 'am', 'um', 'mit', 'und', 'oder', 'aber', 'fur', 'auf',
  'bei', 'aus', 'nach', 'vor', 'durch', 'uber', 'unter', 'neben', 'zwischen',
  // English function words
  'the', 'a', 'an', 'in', 'on', 'at', 'by', 'to', 'for', 'of', 'is',
  // Legal-entity suffixes
  'e.v.', 'ev', 'gbr', 'ug', 'ltd', 'inc', 'gmbh',
  // Roles / disciplines (instruments live in INSTRUMENT_SET, not here)
  'composition', 'performance', 'performances', 'dance', 'butoh', 'action',
  'poetry', 'movements', 'sound art', 'sounddesign', 'video', 'visuals',
  'installation', 'amplifier', 'konzept', 'percussions',
  'mixer', 'mischpult', 'effekte', 'sequenzer', 'sampler',
  'akustik', 'verstarker', 'lautsprecher',
  // Descriptive / genre-ish
  'improvised', 'experimental', 'electronic', 'electronics',
  'concert', 'concerts', 'records', 'record', 'picnic', 'series',
  // Ticketing / logistics
  'donation', 'admission', 'entrance', 'entry', 'ticket', 'tickets',
  'registration', 'reservation', 'eintritt', 'kostenlos', 'frei',
  'price', 'prices', 'preise', 'suggested', 'sliding',
  // Production credits
  'curation', 'curated', 'curators', 'presented', 'funded', 'supported',
  'organized', 'sponsored', 'cooperation', 'collaboration', 'association',
  'veranstaltung', 'zusammenarbeit', 'programminitiative',
  // Accessibility / info
  'wheelchair', 'accessible', 'accessibility', 'newsletter', 'information',
  'info', 'hearing', 'seeing',
  // Event types (German)
  'workshop', 'ausstellungseroffnung', 'eroffnungspanel', 'podiumsdiskussion',
  'konzert', 'konzerte', 'tanz', 'theater',
  // Data-observed false positives
  'trigger', 'warning', 'riverbank', 'box', 'office',
  'dead', 'leaf', 'butterfly', 'invisible', 'thread', 'drone', 'triloka',
  'immersive', 'ambient', 'schrage', 'intense', 'helicopter', 'palace',
  'berlin', 'saxofon', 'dirigentin', 'keyboardpunk',
  'act', 'grunge', 'singer', 'songwriter',
  'monitor', 'kopfhorer', 'mikrofon', 'kabel', 'pedal', 'effector',
]);


// ── Genres / styles ────────────────────────────────────────────────────────
const GENRE_SET = new Set([
  // Jazz
  'jazz', 'free jazz', 'free improvisation', 'avant-garde jazz', 'experimental jazz',
  // Electronic
  'electronic', 'ambient', 'drone', 'minimalism', 'noise',
  'electroacoustic', 'electro-acoustic', 'soundscape', 'live electronics', 'modular synth',
  // Avant-garde / experimental
  'experimental', 'avant-garde', 'modern creative', 'creative music', 'free music',
  'improvisation', 'composition', 'sound art', 'sound installation',
  // New / contemporary classical
  'new music', 'zeitgenössische musik', 'zeitgenössisch', 'baroque', 'early music',
  // Performance art
  'performance art', 'butoh', 'spoken word', 'poetry',
  // Dance / ritual
  'meditative', 'healing', 'sacred', 'ritual',
  // Folk / world
  'folk', 'world music', 'ethno', 'traditional', 'fusion', 'crossover',
  // Rock / pop
  'post-rock', 'postrock', 'metal', 'hardcore', 'indie', 'singer-songwriter',
  // Blues / soul
  'blues', 'soul', 'funk', 'r&b', 'rnb',
  // Dance music
  'techno', 'house', 'dub', 'reggae', 'hip hop', 'hip-hop', 'rap', 'beats',
]);

// ── Instruments (full names + German + abbreviations) ───────────────────────
const INSTRUMENT_SET = new Set([
  // Full instrument names (English)
  'piano', 'guitar', 'bass', 'drums', 'sax', 'saxophone', 'trumpet', 'violin', 'cello', 'viola',
  'flute', 'clarinet', 'percussion', 'electronics', 'synth', 'synthesizer', 'voice', 'vocals', 'voc',
  'turntables', 'turntable', 'keyboard', 'keys', 'organ', 'harp', 'accordion', 'trombone', 'horn', 'tuba',
  'banjo', 'mandolin', 'double bass', 'modular synth', 'daxophone', 'marimba',
  'vibraphone', 'glockenspiel', 'xylophone', 'bassoon', 'oboe', 'recorder', 'recorders',
  'live electronics', 'sampling', 'sampler', 'field recordings', 'amplifier',
  'sequencer', 'sequenzer', 'mixer', 'effector',
  'english horn', 'french horn', 'bass clarinet', 'contra bassoon', 'contrabassoon',
  'baritone sax', 'alto sax', 'tenor sax', 'soprano sax',
  'baritone saxophone', 'alto saxophone', 'tenor saxophone', 'soprano saxophone',
  'prepared piano', 'inside piano', 'ext. guitar', 'feedbacker', 'feedback',
  'contrabass', 'barockvioline', 'cembalo', 'harpsichord', 'blockflote', 'blockflöte',
  'chordophones', 'chordophone', 'reeds', 'reed', 'woodwinds', 'woodwind',
  'vibraphon', 'vibes', 'gamba', 'viola da gamba',
  'baroque trumpet', 'pocket trumpet',
  'e-guitar', 'e-bass', 'e-piano', 'el-guitar', 'el-bass', 'el-piano',
  // Full instrument names (German)
  'gitarre', 'klavier', 'schlagzeug', 'saxophon', 'trompete', 'posaune', 'geige', 'bratsche',
  'flöte', 'klarinetten', 'violoncello', 'schlagwerk', 'bassklarinette',
  'stimme', 'gesang', 'elektronik', 'mischpult',
  'tanbur', 'bendir', 'oud', 'saz', 'ney',
  // Abbreviations with dots
  'kl.', 'klav', 'pno.', 'git.', 'dr.', 'tr.', 'sax.', 'trp.', 'tb.', 'pc.', 'perc.', 'vln.', 'vlc.', 'va.', 'db.', 'cb.',
  'e-p.', 'e-g.', 'e-b.',
  // Abbreviations without dots
  'g', 'b', 'p', 'v', 's', 'dr', 'tb', 'tp', 'trp', 'trpt', 'pc', 'vl', 'vc',
  'eg', 'eb', 'ep', 'tt', 'djing', 'dj', 'bcl',
  // Electronic / DJ
  'laptop', 'computer', 'fx', 'fx pedals', 'pedalboard',
  'loops', 'looper', 'modular', 'prepared', 'prep.',
  // Already-full-name abbreviations
  'vln', 'vlc', 'va', 'db', 'cb', 'bg', 'egtr', 'e-gtr',
  'e-p', 'e-g', 'e-b',
]);

// ── Extended keywords (instruments + genres + roles + techniques) ───────────
// Consumed by analysis.js to build its keyword-extraction set.
const EXTRA_KW_SET = new Set([
  // Extended techniques / uncommon objects
  'objects', 'bow', 'ebow', 'springs', 'drum membranes',
  // Extended German
  'akustik', 'verstärker', 'lautsprecher', 'klavierstücke',
  // Roles / performance modes
  'solo', 'duo', 'trio', 'quartet', 'quartett', 'quintet', 'quintett',
  'butoh', 'dance', 'poetry', 'spoken word', 'action poetry', 'movements',
  'video', 'visuals', 'installation', 'sound art', 'performance', 'composition', 'improvisation',
  'conducting', 'conduction',
  // Genres / styles
  'electronic', 'ambient', 'drone', 'minimalism', 'experimental', 'noise',
  'jazz', 'free jazz', 'free improvisation', 'folk', 'classical', 'contemporary',
  'electroacoustic', 'soundscape', 'new music', 'zeitgenössisch',
  // Other common role words from the data
  'bartender', 'curation', 'sounddesign', 'konzept', 'live set',
  'antennas', 'radio', 'magnetic tape', 'electromagnetic',
  'microphone', 'amplified', 'found objects', 'prepared',
  'ceramic flutes', 'waterbowls', 'spring',
]);


// ── Instrument abbreviation → canonical name ────────────────────────────────
const INSTRUMENT_ABBREV = {
  // Single letters
  'g': 'guitar', 'b': 'bass', 'p': 'piano', 'v': 'violin', 's': 'saxophone',
  // Guitar / bass / piano variants
  'git': 'guitar', 'git.': 'guitar', 'gtr': 'guitar', 'gtr.': 'guitar',
  'e-g': 'electric guitar', 'e-g.': 'electric guitar', 'e-gtr': 'electric guitar', 'egtr': 'electric guitar', 'egtr.': 'electric guitar',
  'e-b': 'electric bass', 'e-b.': 'electric bass', 'e-bass': 'electric bass', 'ebs': 'electric bass',
  'e-p': 'electric piano', 'e-p.': 'electric piano', 'e-pno': 'electric piano',
  'pno': 'piano', 'pno.': 'piano', 'kl': 'klavier', 'kl.': 'klavier', 'klav': 'klavier',
  // Strings
  'vn': 'violin', 'vln': 'violin', 'vln.': 'violin', 'vl': 'violin', 'vl.': 'violin',
  'vc': 'cello', 'vc.': 'cello', 'vlc': 'cello', 'vlc.': 'cello',
  'va': 'viola', 'va.': 'viola',
  'db': 'double bass', 'db.': 'double bass', 'cb': 'contrabass', 'cb.': 'contrabass',
  'bg': 'bass guitar', 'bg.': 'bass guitar',
  // Woodwinds
  'cl': 'clarinet', 'cl.': 'clarinet', 'bcl': 'bass clarinet', 'bcl.': 'bass clarinet',
  'fl': 'flute', 'fl.': 'flute', 'picc': 'piccolo', 'picc.': 'piccolo',
  'ob': 'oboe', 'ob.': 'oboe', 'bn': 'bassoon', 'bn.': 'bassoon',
  'eh': 'english horn', 'eh.': 'english horn',
  // Saxophones
  'sax': 'saxophone', 'sax.': 'saxophone',
  'alt': 'alto saxophone', 'alt.': 'alto saxophone',
  'tsax': 'tenor saxophone', 'tsax.': 'tenor saxophone',
  'ssax': 'soprano saxophone', 'ssax.': 'soprano saxophone',
  'bsax': 'baritone saxophone', 'bsax.': 'baritone saxophone',
  // Brass
  'tpt': 'trumpet', 'tpt.': 'trumpet', 'trp': 'trumpet', 'trp.': 'trumpet',
  'trpt': 'trumpet', 'tp': 'trumpet', 'tp.': 'trumpet',
  'tb': 'trombone', 'tb.': 'trombone', 'trb': 'trombone',
  'hn': 'horn', 'hn.': 'horn',
  'euph': 'euphonium', 'euph.': 'euphonium',
  'tba': 'tuba', 'tba.': 'tuba',
  // Percussion / drums
  'pc': 'percussion', 'pc.': 'percussion', 'perc': 'percussion', 'perc.': 'percussion',
  'dr': 'drums', 'dr.': 'drums', 'drum set': 'drums', 'drumset': 'drums',
  'drum kit': 'drums', 'kit': 'drums',
  // Keys / electronic
  'keys': 'keyboard', 'keyb': 'keyboard', 'keyb.': 'keyboard',
  'synth': 'synthesizer', 'syn': 'synthesizer',
  'mod': 'modular', 'mod.': 'modular', 'modular': 'modular synth',
  'sampler': 'sampler', 'samp': 'sampler', 'samp.': 'sampler',
  'loop': 'looper', 'loops': 'looper',
  'fx': 'effects', 'fx.': 'effects', 'pedal': 'effects', 'pedals': 'effects',
  'laptop': 'laptop', 'comp': 'computer', 'comp.': 'computer',
  'electr': 'electronics', 'elektr': 'electronics',
  'live e': 'live electronics', 'live el': 'live electronics',
  'turnt': 'turntables', 'turnt.': 'turntables', 'tt': 'turntables',
  'djing': 'djing', 'dj': 'djing',
};

// ── Venue-name word boundaries (for fixVenueSpacing) ────────────────────────
const VENUE_WORDS = [
  'Jazzclub', 'Schlot', 'Contemporary', 'Kunstfabrik', 'Alter', 'Schwede', 'Schwedes',
  'Social', 'Club', 'Kühlspot', 'Hošek', 'Art', 'Galerie', 'Studio', 'Raum', 'Halle',
  'Bühne', 'Theater', 'Kirche', 'Klub', 'Cafe', 'Bar', 'Shop', 'Keller', 'Dach', 'Hof',
  'Garten', 'Park', 'Strasse', 'Platz', 'Weg', 'Ufer', 'Insel', 'Bruecke', 'Tor', 'Haus',
  'Bau', 'Werk', 'Schloss', 'Burg', 'Turm', 'Mauer', 'Feld', 'Wald', 'See', 'Fluss', 'Berg',
  'Tal', 'Dorf', 'Stadt', 'Land', 'Markt', 'Rathaus', 'Schule', 'Klinik', 'Bahnhof',
  'Flughafen', 'Hafen', 'Stadion', 'Arena', 'Museum', 'Bibliothek', 'Universitat', 'Institut',
  'Labor', 'Zentrum', 'Forum', 'Kultur', 'Kunst', 'Musik', 'Tanz', 'Oper', 'Ballett',
  'Konzert', 'Festival', 'Woche', 'Tage', 'Nacht', 'Abend', 'Morgen', 'Mittag', 'Vormittag',
  'Nachmittag', 'Frueh', 'Spaet', 'Heute', 'Gestern', 'Uebermorgen',
];

// Expose for module contexts (tests); harmless in the browser/worker global scope.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    foldDiacritics, CONNECTORS, NOISE_WORDS, GENRE_SET,
    INSTRUMENT_SET, EXTRA_KW_SET, INSTRUMENT_ABBREV, VENUE_WORDS,
  };
}
