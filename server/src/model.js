const request = require('request-promise-native');
const crypto = require('crypto');
const nJ = require('normalize-json');
const promisify = require('util').promisify;
const EventEmitter = require('events');
const config = require('./config');
const dao = require('./dao.mongo');

class RpEventEmitter extends EventEmitter {}
const events = module.exports.events = new RpEventEmitter();

const roomOptionsSchema = nJ({
    'title': [ String, config.get('maxTitleLength') ],
    'desc': [ {$optional:String}, config.get('maxDescLength') ]
});
const addCharaSchema = nJ({
    'name': [ String, config.get('maxCharaNameLength') ],
    'color': /^#[0-9a-f]{6}$/g
});
const addMessageSchema = nJ({
    'content': [ String, config.get('maxMessageContentLength') ],
    'type': [ 'narrator', 'chara', 'ooc' ],
    'charaId': (msg)=> msg.type === 'chara' ? [ Number.isInteger, 0, Infinity ] : undefined,
    'challenge': [ String, 128 ]
});
const editMessageSchema = nJ({
    'id': [ Number.isInteger, 0, Infinity ],
    'content': [ String, config.get('maxMessageContentLength') ],
    'secret': [ String, 64 ]
});

async function generateRpCode() {
    let length = config.get('rpCodeLength');
    let characters = config.get('rpCodeChars');

    let numCryptoBytes = length * 2; // ample bytes just in case
    while (true) {
        let buffer = await promisify(crypto.randomBytes)(numCryptoBytes);

        let token = buffer.toString('base64');
        let rpCode = token.match(new RegExp(characters.split('').join('|'), 'g')).join('').substr(0, length);
        
        if (rpCode.length !== length) continue;

        let rp = await dao.getRoomByCode(rpCode);
        if (!rp) return rpCode;
    }
}

module.exports.generateChallenge = async function() {
    let buf = await promisify(crypto.randomBytes)(32);

    let secret = buf.toString('hex');
    let hash = createHash(secret);

    return {secret, hash};
};

function createHash(secret) {
    return crypto.createHash('sha512')
        .update(secret)
        .digest('hex');
}

module.exports.createRp = async function(input) {
    let roomOptions;
    try {
        roomOptions = roomOptionsSchema(input);
    }
    catch (error) {
        throw {code: 'BAD_RP', details: error.message};
    }

    let rpCode = await generateRpCode();
    await dao.addRoom(rpCode, roomOptions);

    return { rpCode };
};

module.exports.getRp = async function(rpCode) {
    if (typeof rpCode !== 'string') throw {code: 'BAD_RPCODE'};

    let data = await dao.getRoomByCode(rpCode);
    if (!data) throw {code: 'RP_NOT_FOUND'};

    return data;
};

function addMessageMetadata(msg, ipid) {
    msg.timestamp = Date.now() / 1000;
    msg.ipid = ipid;
}

module.exports.addMessage = async function(rpid, connectionId, input, ipid) {
    let msg;
    try {
        msg = addMessageSchema(input);
    }
    catch (error) {
        throw {code: 'BAD_MSG', details: error.message};
    }
    
    // store & broadcast
    if (msg.type === 'chara') {
        // charas must be in the chara list
        let exists = await dao.charaExists(rpid, msg.charaId);
        if (!exists) throw {code: 'CHARA_NOT_FOUND', details: `no character with id ${msg.charaId}`};
    }

    addMessageMetadata(msg, ipid);

    await dao.addMessage(rpid, msg);

    events.emit('add message', rpid, connectionId, msg);
    return msg;
};

module.exports.addImage = async function(rpid, connectionId, url, ipid) {
    if (typeof url !== 'string') throw {code: 'BAD_URL'};

    // validate image
    let res;
    try {
        res = await request.head(url);
    }
    catch (err) {
        throw { code: 'URL_FAILED', details: err.message };
    }
    if (!res['content-type']) throw { code: 'UNKNOWN_CONTENT' };
    if (!res['content-type'].startsWith('image/')) throw {code: 'BAD_CONTENT'};

    // store & broadcast
    let msg = {
        type: 'image',
        url: url
    };

    addMessageMetadata(msg, ipid);

    await dao.addMessage(rpid, msg);

    events.emit('add message', rpid, connectionId, msg);
    return msg;
};

module.exports.addChara = async function(rpid, connectionId, inputChara, ipid) {
    let chara;
    try {
        chara = addCharaSchema(inputChara);
    }
    catch (error) {
        throw {code: 'BAD_CHARA', details: error.message};
    }

    await dao.addChara(rpid, chara);

    events.emit('add character', rpid, connectionId, chara);
    return chara;
};

module.exports.editMessage = async function(rpid, connectionId, input, ipid) {
    let editInfo;
    try {
        editInfo = editMessageSchema(input);
    }
    catch (error) {
        throw {code: 'BAD_EDIT', details: error.message};
    }

    // check if the message is there
    let msg = await dao.getMessage(rpid, editInfo.id);
    if (!msg) throw { code: 'BAD_MSG_ID' };

    if (createHash(editInfo.secret) !== msg.challenge) throw { code: 'BAD_SECRET'};

    msg.content = editInfo.content;
    msg.edited = (Date.now() / 1000);

    await dao.editMessage(rpid, editInfo.id, msg);

    events.emit('edit message', rpid, connectionId, editInfo.id, msg);
    return msg;
};
