// Testes unitários das funções puras do update-manager.
// Executa em Node puro, sem browser, sem framework.
// Rodar: node host/update-manager.test.js

var um = require("../client/update-manager");
var _compareSemver   = um._compareSemver;
var _shouldShowUpdate = um._shouldShowUpdate;

var passed = 0;
var failed = 0;

function assert(name, actual, expected) {
  if (actual === expected) {
    console.log("ok  " + name);
    passed++;
  } else {
    console.log("FAIL " + name + " — expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
    failed++;
  }
}

// --- _compareSemver ---
assert("semver: remoto maior (minor)",  _compareSemver("1.2.0", "1.1.0"),  1);
assert("semver: iguais",                _compareSemver("1.0.0", "1.0.0"),  0);
assert("semver: remoto menor",          _compareSemver("1.0.0", "1.1.0"), -1);
assert("semver: major bump",            _compareSemver("2.0.0", "1.9.9"),  1);
assert("semver: minor duplo dígito",    _compareSemver("1.10.0", "1.9.0"), 1);
assert("semver: null guard (a=null)",   _compareSemver(null, "1.0.0"),     0);
assert("semver: null guard (b=null)",   _compareSemver("1.0.0", null),     0);

// --- _shouldShowUpdate ---
// versão nova nunca dismissada, modal fechado → deve mostrar
assert("should: nova versao, sem dismiss, modal fechado",
  _shouldShowUpdate(null, null, "1.2.0", false), true);

// mesma versão dismissada há 3h → deve mostrar (>= 2h)
assert("should: mesma versao, 3h atras, modal fechado",
  _shouldShowUpdate("1.2.0", Date.now() - 3 * 60 * 60 * 1000, "1.2.0", false), true);

// mesma versão dismissada há 1h → NÃO deve mostrar (< 2h)
assert("should: mesma versao, 1h atras, modal fechado",
  _shouldShowUpdate("1.2.0", Date.now() - 1 * 60 * 60 * 1000, "1.2.0", false), false);

// versão nova mas modal aberto → NÃO deve mostrar
assert("should: nova versao, modal aberto",
  _shouldShowUpdate(null, null, "1.2.0", true), false);

// mesma versão, dismissedAt null → deve mostrar
assert("should: mesma versao, dismissedAt null",
  _shouldShowUpdate("1.2.0", null, "1.2.0", false), true);

// dismissedVersion null (primeira execução) → deve mostrar
assert("should: primeira execucao (dismissedVersion null)",
  _shouldShowUpdate(null, null, "1.1.0", false), true);

// mesma versão dismissada exatamente 2h atrás → deve mostrar (>= 2h)
assert("should: mesma versao, exatamente 2h, modal fechado",
  _shouldShowUpdate("1.2.0", Date.now() - 2 * 60 * 60 * 1000, "1.2.0", false), true);

// versão nova com modal aberto → NÃO mostrar mesmo sendo versão diferente
assert("should: versao diferente, modal aberto",
  _shouldShowUpdate("1.1.0", Date.now(), "1.2.0", true), false);

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
