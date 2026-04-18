export default function handler(req, res) {
  res.json({
    test: 'OK',
    time: new Date().toISOString(),
    msg: 'This is the test endpoint from api/test.js — fresh deployment'
  });
}
