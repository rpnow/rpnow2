const bodyParser = require('body-parser');

const model = require('./model');

let router = require('express').Router();
router.use(require('compression')());
router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: true }));

router.post('/rp.json', (req, res, next) => {
    let roomOptions = req.body;
    model.createRp(roomOptions)
        .then(data => res.status(201).json(data))
        .catch(err => next(err))
})

router.get('/challenge.json', (req, res, next) => {
    model.generateChallenge()
        .then(data => res.status(200).json(data))
        .catch(err => next(err))
})

router.all('*', (req, res, next) => {
    next({ code: 'UNKNOWN_REQUEST'});
})

router.use((err, req, res, next) => {
    res.status(400).json({ error: err });
});

module.exports = router;