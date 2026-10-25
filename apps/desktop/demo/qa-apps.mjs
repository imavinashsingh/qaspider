/** Controlled test applications: distinct markup, same browser adapter. No real data. */
export function serveQaApplication(request, response) {
  if (request.method !== 'GET') return false;
  const path = request.url;
  if (!['/registration', '/contact', '/contact-changed', '/ambiguous', '/escape', '/sensitive-link'].includes(path)) return false;
  if (path === '/escape') { response.writeHead(302, { Location: 'http://127.0.0.1:1/private' }); response.end(); return true; }
  if (path === '/sensitive-link') { response.end('<a href="/.env">Read configuration</a>'); return true; }
  if (path === '/ambiguous') { response.end('<button>Submit</button><button>Submit</button><p id="result">Ready</p>'); return true; }
  const registration = path === '/registration';
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>${registration ? 'Registration' : 'Contact us'}</title>
  <style>body{font:18px system-ui;background:#f6f7fc;color:#18283b;margin:50px;max-width:680px}label{display:block;margin:16px 0}input,textarea,select,button{font:inherit;padding:10px}button{background:#3148a5;color:white;border:0;border-radius:6px}</style>
  ${registration ? `<main><h1>Create a synthetic account</h1><form novalidate id="registration"><label>Your name <input name="name" aria-label="Your name"></label><label>Email address <input type="email" name="email" aria-label="Email address"></label><label>Account type <select name="type" aria-label="Account type"><option value="basic">Basic</option><option value="test">Test</option></select></label><button>Create account</button></form><p role="status" id="result">Ready</p></main>` : `<section><header><h1>Talk to our test team</h1></header><article><form novalidate id="message"><fieldset><legend>Your details</legend><label for="contact-name">Name</label><input id="contact-name" name="name"><label for="contact-email">Email</label><input id="contact-email" type="email" name="email"></fieldset><label for="body">Message</label><textarea id="body" name="message"></textarea><footer><button>${path === '/contact-changed' ? 'Send Message' : 'Submit'}</button></footer></form></article><aside><output id="result" role="status">Ready</output></aside></section>`}
  <script>document.querySelector('form').addEventListener('submit', event => {
    event.preventDefault(); const data = new FormData(event.target), output = document.getElementById('result');
    if (!data.get('name') || !data.get('email')) output.textContent = 'Name and email are required';
    else if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(data.get('email'))) output.textContent = 'Enter a valid email';
    else if (${registration} && data.get('email') === 'duplicate@example.test') output.textContent = 'Email already registered';
    else output.textContent = ${registration ? "'Registration complete'" : "'Message received'"};
  });</script></html>`);
  return true;
}
