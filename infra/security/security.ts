// Scanner self-tests only; never executed/imported by the product.
// ruleid: agentbrake-no-dynamic-code
eval('untrusted');
// ruleid: agentbrake-no-dynamic-code
new Function('untrusted');
// ok: agentbrake-no-dynamic-code
JSON.parse('{"fixture":true}');
// ruleid: agentbrake-no-shell-option
const unsafe = {shell:true};
// ok: agentbrake-no-shell-option
const safe = {shell:false};
// ruleid: agentbrake-no-disabled-tls
const tls = {rejectUnauthorized:false};
// ruleid: agentbrake-no-browser-secret-storage
localStorage.setItem('token','fixture');
// ruleid: agentbrake-no-request-log
console.log(req.headers.authorization);
// ruleid: agentbrake-request-sql
db.query(req.body.sql);
