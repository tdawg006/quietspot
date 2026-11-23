/* QuietSpot: students report how full a study space is; the site shows the latest picture.
   Version 2: shared Supabase database, student login and campus photos. */

// ---------- 1. Settings and connection ----------
var MAX_AGE = 90;                        // reports older than 90 min are ignored
var NOISE = ["Silent", "Low hum", "Loud"];

var sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

var spaces = [];     // loaded from the "spaces" table
var reports = {};    // { spaceId: [ {time, occ, noise}, ... ] } newest first
var photoRecords = {};
var confirmations = {};
var flags = {};
var user = null;     // the logged-in student, or null

// Stop database text from being treated as HTML
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
  });
}

function photoUrl(space) {
  if (!space.image_path) return "";
  return SUPABASE_URL + "/storage/v1/object/public/" + PHOTO_BUCKET + "/" + encodeURIComponent(space.image_path);
}

// ---------- 2. Loading data from the database ----------
async function loadSpaces() {
  var res = await sb.from("spaces").select("*").order("name");
  if (res.error) throw res.error;
  spaces = res.data;
}

async function loadPhotos() {
  var res = await sb.from("space_photos").select("space_id,path").order("created_at", {ascending: true});
  if (res.error) throw res.error;
  photoRecords = {};
  res.data.forEach(function (r) { (photoRecords[r.space_id] ||= []).push(r.path); });
}

async function loadReports() {
  var since = new Date(Date.now() - MAX_AGE * 60000).toISOString();
  var res = await sb.from("reports").select("space_id,occ,noise,created_at")
    .gte("created_at", since).order("created_at", {ascending: false});
  if (res.error) throw res.error;
  var out = {};
  res.data.forEach(function (r) {
    (out[r.space_id] = out[r.space_id] || []).push({time: new Date(r.created_at).getTime(), occ: r.occ, noise: r.noise});
  });
  reports = out;
}

async function loadCommunity() {
  var results = await Promise.all([sb.from("space_confirmations").select("space_id,user_id"), sb.from("space_flags").select("space_id,user_id")]);
  if (results[0].error) throw results[0].error;
  if (results[1].error) throw results[1].error;
  confirmations = {}; flags = {};
  results[0].data.forEach(function(r){ (confirmations[r.space_id] ||= []).push(r.user_id); });
  results[1].data.forEach(function(r){ (flags[r.space_id] ||= []).push(r.user_id); });
}

async function refresh() {
  try {
    await Promise.all([loadSpaces(), loadPhotos(), loadReports(), loadCommunity()]);
    updateSpaceOptions();
    render();
  } catch (e) {
    showToast("Could not reach the database");
  }
}

// ---------- 3. Working out how full a space is ----------
function minutesAgo(time) {
  return (Date.now() - time) / 60000;
}

// Take recent reports and average them. Newer reports count more.
function estimate(id) {
  var recent = (reports[id] || []).filter(function (r) {
    return minutesAgo(r.time) <= MAX_AGE;
  });
  if (recent.length === 0) return null;

  var weightSum = 0, total = 0;
  recent.forEach(function (r) {
    var weight = 1 / (1 + minutesAgo(r.time) / 20);
    weightSum += weight;
    total += weight * r.occ;
  });
  return {
    occ: total / weightSum,
    noise: recent[0].noise,
    count: recent.length,
    age: Math.max(0, Math.round(minutesAgo(recent[0].time))),
    latestTime: recent[0].time
  };
}

function levelOf(occ) {
  if (occ < 35) return ["Plenty of seats", "ok"];
  if (occ < 70) return ["Filling up", "mid"];
  if (occ < 95) return ["Almost full", "bad"];
  return ["No seats", "bad"];
}

function ageText(age) {
  return age < 1 ? "just now" : age + " min ago";
}

function reportTimestamp(time) {
  return new Intl.DateTimeFormat("en-IN", {dateStyle:"medium", timeStyle:"short", timeZone:"Asia/Kolkata"}).format(new Date(time)) + " IST";
}
function matchScore(item, need) {
  var s = item.space, info = item.info;
  if (!info) return -999;
  var score = (100 - info.occ) * 0.65 + (2 - info.noise) * 12 + Math.max(0, 90 - info.age) * .12;
  score += Math.min((confirmations[s.id] || []).length, 10) * 1.5;
  score -= Math.min((flags[s.id] || []).length, 5) * 12;
  if (need === "outlets" && s.outlets) score += 12;
  if (need === "silent" && s.rule === "silent") score += 12;
  if (need === "talk" && s.rule === "talk") score += 12;
  return Math.round(score);
}
function matches(space, need) {
  if (need === "silent") return space.rule === "silent";
  if (need === "talk") return space.rule === "talk";
  if (need === "outlets") return space.outlets;
  return true;
}

// ---------- 4. Showing everything on the page ----------
function render() {
  var need = document.getElementById("need").value;
  var sortBy = document.getElementById("sort").value;

  var term = document.getElementById("search").value.trim().toLowerCase();
  var list = spaces.filter(function (s) { return matches(s, need) && (s.name + " " + s.building + " " + (s.description || "")).toLowerCase().includes(term); })
                   .map(function (s) { return {space: s, info: estimate(s.id)}; });

  list.sort(function (a, b) {
    if (sortBy === "smart") return matchScore(b, need) - matchScore(a, need);
    if (sortBy === "name") return a.space.name.localeCompare(b.space.name);
    if (sortBy === "fresh") return (a.info ? a.info.age : 999) - (b.info ? b.info.age : 999);
    return (a.info ? a.info.occ : 101) - (b.info ? b.info.occ : 101);
  });

  var grid = document.getElementById("grid");
  grid.innerHTML = list.length === 0
    ? '<div class="empty">No spaces match this filter.</div>'
    : list.map(cardHtml).join("");

  // if a photo fails to load, swap it for the grey placeholder
  Array.prototype.forEach.call(grid.querySelectorAll("img.photo"), function (img) {
    img.onerror = function () {
      var d = document.createElement("div");
      d.className = "nophoto";
      img.replaceWith(d);
    };
  });
  showBestPick(list);
}

function cardHtml(item) {
  var s = item.space, info = item.info;
  var status = info ? levelOf(info.occ) : ["No recent reports", "none"];
  var filled = info ? Math.round(info.occ / 10) : 0;
  var dots = "";
  for (var i = 0; i < 10; i++) dots += '<i class="' + (i < filled ? "f" : "") + '"></i>';
  var reportLine = info
    ? info.count + " report" + (info.count > 1 ? "s" : "") + ", latest " + ageText(info.age) + " (" + reportTimestamp(info.latestTime) + ")"
    : "Be the first to report";
  var verified = (confirmations[s.id] || []).length, flagged = (flags[s.id] || []).length;
  var photos = photoRecords[s.id] || [];
  var cover = photos.length ? sb.storage.from(PHOTO_BUCKET).getPublicUrl(photos[0]).data.publicUrl : photoUrl(s);
  var pic = cover
    ? '<img class="photo" loading="lazy" alt="' + esc(s.name) + '" src="' + esc(cover) + '">'
    : '<div class="nophoto"></div>';

  return '<article class="card">' + pic +
    '<div class="meta">' + esc(s.building) + '</div>' +
    (s.description ? '<p class="description">' + esc(s.description) + '</p>' : '') +
    '<h3>' + esc(s.name) + '</h3>' +
    '<div class="status ' + status[1] + '">' + status[0] + '</div>' +
    '<div class="seats ' + status[1] + '">' + dots + '</div>' +
    '<div class="meta">' + reportLine + '</div>' +
    '<div class="meta">Community: ' + verified + ' confirmation(s)' + (flagged ? ' · ' + flagged + ' flag(s)' : '') + '</div>' +
    '<div class="tags"><span class="tag">' + (s.rule === "silent" ? "Silent zone" : "Talking allowed") + '</span>' +
    (s.outlets ? '<span class="tag">Power outlets</span>' : '') +
    (info ? '<span class="tag">Now: ' + NOISE[info.noise] + '</span>' : '') + '</div>' +
    '<div class="links">' + (s.latitude != null && s.longitude != null ? '<a target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&amp;query=' + encodeURIComponent(s.latitude + ',' + s.longitude) + '">Map & directions</a>' : '') + (photos.length > 1 ? '<span class="photo-count">' + photos.length + ' photos</span>' : '') + '</div>' +
    '<div class="community-actions"><button type="button" class="btn ghost small" data-action="confirm" data-space="' + esc(s.id) + '">✓ Confirm</button><button type="button" class="btn ghost small" data-action="flag" data-space="' + esc(s.id) + '">Flag</button><button type="button" class="btn ghost small" data-action="correct" data-space="' + esc(s.id) + '">Suggest edit</button></div>' +
    '<div class="row"><span class="meta">Seats: about ' + s.cap + '</span>' +
    '<button class="btn ghost small" data-space="' + esc(s.id) + '">Report</button></div>' +
    '</article>';
}

function showBestPick(list) {
  var box = document.querySelector(".pick");
  var name = document.getElementById("pickName");
  var infoBox = document.getElementById("pickInfo");
  var btn = document.getElementById("pickBtn");

  var good = list.filter(function (x) { return x.info && x.info.occ < 70; });
  good.sort(function (a, b) { return matchScore(b, document.getElementById("need").value) - matchScore(a, document.getElementById("need").value); });

  box.style.backgroundImage = "";
  box.classList.remove("hasphoto");
  if (good.length > 0) {
    var best = good[0];
    name.textContent = best.space.name;
    infoBox.textContent = levelOf(best.info.occ)[0] + ", noise: " + NOISE[best.info.noise].toLowerCase() +
      ". Last report " + reportTimestamp(best.info.latestTime) + ". Smart score: " + matchScore(best, document.getElementById("need").value) + ".";
    btn.hidden = false;
    btn.dataset.space = best.space.id;
    var bestPhotos = photoRecords[best.space.id] || [];
    var bestCover = bestPhotos.length ? sb.storage.from(PHOTO_BUCKET).getPublicUrl(bestPhotos[0]).data.publicUrl : photoUrl(best.space);
    if (bestCover) {
      box.style.backgroundImage = "linear-gradient(rgba(27,31,59,.78),rgba(27,31,59,.78)),url('" + bestCover + "')";
      box.classList.add("hasphoto");
    }
  } else {
    name.textContent = "No free seat reported";
    infoBox.textContent = "Everything matching your filter is full or has no recent reports.";
    btn.hidden = true;
  }
}

// ---------- 5. Login ----------
var authDlg = document.getElementById("authDlg");
var signUpMode = false;

function setAuthMode(isSignUp) {
  signUpMode = isSignUp;
  document.getElementById("authTitle").textContent = isSignUp ? "Create account" : "Log in";
  document.getElementById("authSubmit").textContent = isSignUp ? "Sign up" : "Log in";
  document.getElementById("authSwitch").textContent = isSignUp ? "Already have an account? Log in" : "New here? Create an account";
  document.getElementById("authErr").textContent = "";
}

function openAuth() { setAuthMode(false); authDlg.showModal(); }

function updateAuthUi() {
  document.getElementById("authBtn").textContent = user ? "Log out" : "Log in";
  document.getElementById("who").textContent = user ? user.email : "";
}

document.getElementById("authBtn").onclick = async function () {
  if (user) { await sb.auth.signOut(); showToast("Logged out"); }
  else openAuth();
};
document.getElementById("authCancel").onclick = function () { authDlg.close(); };
document.getElementById("authSwitch").onclick = function (e) { e.preventDefault(); setAuthMode(!signUpMode); };

document.getElementById("authForm").onsubmit = async function (e) {
  e.preventDefault();
  var email = document.getElementById("aEmail").value.trim();
  var pass = document.getElementById("aPass").value;
  var err = document.getElementById("authErr");
  err.textContent = "";

  var res = signUpMode
    ? await sb.auth.signUp({email: email, password: pass})
    : await sb.auth.signInWithPassword({email: email, password: pass});

  if (res.error) { err.textContent = res.error.message; return; }
  if (signUpMode && !res.data.session) {      // e-mail confirmation is switched on
    err.textContent = "Check your email and click the confirmation link, then log in.";
    return;
  }
  authDlg.close();
  showToast(signUpMode ? "Account created" : "Logged in");
};

sb.auth.onAuthStateChange(function (event, session) {
  user = session ? session.user : null;
  updateAuthUi();
});

// ---------- 6. The report popup ----------
var dialog = document.getElementById("dlg");
var spaceSelect = document.getElementById("rSpace");

function openReport(id) {
  if (!user) { showToast("Please log in to report"); openAuth(); return; }
  if (id) spaceSelect.value = id;
  document.getElementById("rOcc").value = "";
  document.getElementById("err").textContent = "";
  dialog.showModal();
}

function showToast(message) {
  var t = document.getElementById("toast");
  t.textContent = message;
  t.classList.add("show");
  setTimeout(function () { t.classList.remove("show"); }, 2400);
}

document.getElementById("reportTop").onclick = function () { openReport(); };
document.getElementById("pickBtn").onclick = function (e) { openReport(e.target.dataset.space); };
document.getElementById("cancel").onclick = function () { dialog.close(); };
document.getElementById("need").onchange = render;
document.getElementById("sort").onchange = render;
document.getElementById("search").oninput = render;
document.getElementById("grid").onclick = async function (e) {
  var button = e.target.closest("button[data-space]");
  if (!button) return;
  var id = button.dataset.space, action = button.dataset.action;
  if (!action) { openReport(id); return; }
  if (!user) { showToast("Log in to contribute"); openAuth(); return; }
  if (action === "correct") {
    document.getElementById("correctionSpace").value = id;
    document.getElementById("correctionForm").reset();
    document.getElementById("correctionErr").textContent = "";
    document.getElementById("correctionDlg").showModal(); return;
  }
  button.disabled = true;
  try {
    var table = action === "confirm" ? "space_confirmations" : "space_flags";
    var res = await sb.from(table).upsert({space_id:id,user_id:user.id}, {onConflict:"space_id,user_id"});
    if (res.error) throw res.error;
    await refresh(); showToast(action === "confirm" ? "Space confirmed!" : "Flag submitted for review");
  } catch(ex) { showToast("Could not submit: " + ex.message); }
  finally { button.disabled = false; }
};
document.getElementById("correctionCancel").onclick = function(){document.getElementById("correctionDlg").close();};
document.getElementById("correctionForm").onsubmit = async function(e) {
  e.preventDefault();
  var err = document.getElementById("correctionErr"); err.textContent = "";
  if (!user) {err.textContent="Log in first";return;}
  var details = document.getElementById("correctionText").value.trim();
  if (details.length < 10) {err.textContent="Please describe the correction in at least 10 characters";return;}
  var res = await sb.from("space_corrections").insert({space_id:document.getElementById("correctionSpace").value,user_id:user.id,details:details});
  if (res.error) {err.textContent=res.error.message;return;}
  document.getElementById("correctionDlg").close();showToast("Correction submitted for review");
};

// submitting the report: saved in the database
document.getElementById("form").onsubmit = async function (e) {
  e.preventDefault();
  var err = document.getElementById("err");
  var occ = document.getElementById("rOcc").value;
  if (occ === "") { err.textContent = "Choose how full the space is."; return; }

  var res = await sb.from("reports").insert({
    space_id: spaceSelect.value,
    occ: parseInt(occ, 10),
    noise: parseInt(document.getElementById("rNoise").value, 10)
  });

  if (res.error) {
    err.textContent = (res.error.message || "").indexOf("COOLDOWN") >= 0
      ? "You already reported this space. Try again in a few minutes."
      : "Could not send: " + res.error.message;
    return;
  }
  dialog.close();
  await refresh();
  showToast("Report sent. Thanks!");
};

// ---------- 7. Start ----------
function updateSpaceOptions() {
  var current = spaceSelect.value;
  spaceSelect.innerHTML = spaces.map(function (x) {
    return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>';
  }).join("");
  if (spaces.some(function (x) { return x.id === current; })) spaceSelect.value = current;
}

// Create spaces only as the signed-in user. Database policies enforce ownership.
var spaceDlg = document.getElementById("spaceDlg");
document.getElementById("addSpaceBtn").onclick = function () {
  if (!user) { showToast("Log in to add a space"); openAuth(); return; }
  document.getElementById("spaceForm").reset();
  document.getElementById("spaceErr").textContent = "";
  document.getElementById("geoStatus").textContent = "Coordinates should point to the study space, not your home.";
  spaceDlg.showModal();
};
document.getElementById("spaceCancel").onclick = function () { spaceDlg.close(); };
document.getElementById("getCoords").onclick = function () {
  var status = document.getElementById("geoStatus");
  if (!navigator.geolocation) { status.textContent = "Geolocation is unavailable. Enter coordinates manually."; return; }
  status.textContent = "Requesting location permission…";
  navigator.geolocation.getCurrentPosition(function (pos) {
    document.getElementById("sLat").value = pos.coords.latitude.toFixed(6);
    document.getElementById("sLng").value = pos.coords.longitude.toFixed(6);
    status.textContent = "Location captured (±" + Math.round(pos.coords.accuracy) + " m). Check that it points to the space.";
  }, function () { status.textContent = "Location permission denied or unavailable. You can enter coordinates manually."; },
  {enableHighAccuracy:true,timeout:12000,maximumAge:0});
};

document.getElementById("spaceForm").onsubmit = async function (e) {
  e.preventDefault();
  var err = document.getElementById("spaceErr"), btn = document.getElementById("spaceSubmit");
  err.textContent = "";
  if (!user) { err.textContent = "Please log in again."; return; }
  var latRaw = document.getElementById("sLat").value, lngRaw = document.getElementById("sLng").value;
  if (!!latRaw !== !!lngRaw) { err.textContent = "Enter both latitude and longitude, or neither."; return; }
  var files = Array.from(document.getElementById("sPhotos").files);
  if (files.length > 5 || files.some(function (f) { return f.size > 5 * 1024 * 1024 || !["image/jpeg","image/png","image/webp"].includes(f.type); })) {
    err.textContent = "Choose up to 5 JPG, PNG or WebP photos, each under 5 MB."; return;
  }
  var name = document.getElementById("sName").value.trim(), building = document.getElementById("sBuilding").value.trim();
  if (!name || !building) { err.textContent = "Name and building are required."; return; }
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    var id = crypto.randomUUID();
    var payload = {id:id,name:name,building:building,description:document.getElementById("sDescription").value.trim(),
      rule:document.getElementById("sRule").value,outlets:document.getElementById("sOutlets").checked,
      cap:Number(document.getElementById("sCap").value),latitude:latRaw ? Number(latRaw) : null,
      longitude:lngRaw ? Number(lngRaw) : null,created_by:user.id};
    var created = await sb.from("spaces").insert(payload);
    if (created.error) throw created.error;
    var failed = 0;
    for (var i = 0; i < files.length; i++) {
      var ext = files[i].type === "image/png" ? "png" : files[i].type === "image/webp" ? "webp" : "jpg";
      var path = user.id + "/" + id + "/" + crypto.randomUUID() + "." + ext;
      var uploaded = await sb.storage.from(PHOTO_BUCKET).upload(path,files[i],{contentType:files[i].type,upsert:false});
      if (uploaded.error) { failed++; continue; }
      var saved = await sb.from("space_photos").insert({space_id:id,path:path,uploaded_by:user.id});
      if (saved.error) { failed++; await sb.storage.from(PHOTO_BUCKET).remove([path]); }
    }
    spaceDlg.close();
    await refresh();
    showToast(failed ? "Space added, but " + failed + " photo(s) failed to upload." : "New space added!");
  } catch (ex) { err.textContent = ex.message || "Could not save space."; }
  finally { btn.disabled = false; btn.textContent = "Add space"; }
};

async function start() {
  document.getElementById("grid").innerHTML = '<div class="loading">Loading spaces…</div>';
  if (SUPABASE_URL.indexOf("PASTE_") === 0) {
    document.getElementById("grid").innerHTML = '<div class="empty">Add your Supabase URL and key in js/config.js</div>';
    return;
  }
  var s = await sb.auth.getSession();
  user = s.data.session ? s.data.session.user : null;
  updateAuthUi();
  try {
    await Promise.all([loadSpaces(), loadPhotos(), loadReports(), loadCommunity()]);
    updateSpaceOptions();
    render();
  } catch (e) {
    document.getElementById("grid").innerHTML = '<div class="empty">Could not load data. Check js/config.js and that schema.sql was run.</div>';
  }
  setInterval(refresh, 30000);   // pick up other students' reports every 30 seconds
}
start();
