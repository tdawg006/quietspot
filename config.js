// QuietSpot browser configuration. Set credentials using connect.html; no code editing needed.
var quietspotSettings;
try { quietspotSettings = JSON.parse(localStorage.getItem('quietspot_supabase_settings') || 'null'); }
catch (_) { quietspotSettings = null; }
var SUPABASE_URL = quietspotSettings && quietspotSettings.url || '';
var SUPABASE_ANON_KEY = quietspotSettings && quietspotSettings.key || '';
var PHOTO_BUCKET = 'campus-photos';
window.QUIETSPOT_CONFIGURED = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;
