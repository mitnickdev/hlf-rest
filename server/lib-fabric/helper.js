/**
 * Copyright 2017 IBM All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an 'AS IS' BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
'use strict';
var log4js = require('log4js');
var logger = log4js.getLogger('Helper');
logger.setLevel('DEBUG');

var path = require('path');
var fs = require('fs-extra');
var User = require('fabric-client/lib/User.js');
var Peer = require('fabric-client/lib/Peer.js');
var EventHub = require('fabric-client/lib/EventHub.js');
var Orderer = require('fabric-client/lib/Orderer.js');
var Channel = require('fabric-client/lib/Channel.js');

var CopService = require('fabric-ca-client');
var config = require('../config.json');

var hfc = require('./hfc');
var ORGS = hfc.getConfigSetting('network-config');
var CONFIG_DIR = hfc.getConfigSetting('config-dir');

/**
 * @type {Object<Promise<Client>>}
 */
var clients = {};
/**
 * @type {Object<CopService>}
 */
var caClients = {};

//


/**
 * (as admin)
 * @param {string} orgID
 * @return {CopService}
 */
function getCAClient(orgID){
  var username = getAdminCredentials().username;
  var key = username+'/'+orgID;
  if(!caClients[key]) {

    let caUrl = ORGS[orgID].ca;
    let cryptoSuite = hfc.newCryptoSuite();
    cryptoSuite.setCryptoKeyStore(hfc.newCryptoKeyStore({path: getKeyStoreForOrg(username, orgID)}));

    caClients[key] = new CopService(caUrl, null /*default TLS opts*/, '' /* default CA */, cryptoSuite);
  }
  return caClients[key];
}

/**
 * set up the client objects for each org
 * @param {string} username
 * @param {string} orgID
 * @returns {Promise<Client>}
 */
function _initClientForOrg(username, orgID){
  if(!ORGS[orgID]){
    throw new Error('No such organisation: '+orgID);
  }

  let client = new hfc(); // jshint ignore: line
  let cryptoSuite = hfc.newCryptoSuite();
  cryptoSuite.setCryptoKeyStore(hfc.newCryptoKeyStore({path: getKeyStoreForOrg(username, orgID)}));
  client.setCryptoSuite(cryptoSuite);

  // init client key store and context
  var p;
  if( isAdmin(username) ){
    // p = _setClientAdminContext(client, orgID);
    p = _setClientAdminContext2(client, orgID);
  } else {
    p = _setClientUserContext(client, username, orgID);
  }
  return p.then(()=>client);
}


/**
 * @param {string} username
 * @param {string} orgID
 * @returns {Promise<User>}
 */
function getClientUser(username, orgID){
  return getClientForOrg(username, orgID)
    .then(client=>client._userContext);
}

/**
 * @param {string} orgID
 * @returns {Promise<User>}
 */
function getClientAdmin(orgID){
  var adminUser = getAdminCredentials();
  return getClientUser(adminUser.username, orgID);
}



/**
 * @param {Client} client
 * @param {string} channelID
 * @param {string} orgID
 * @returns {Channel}
 */
function _getClientChannel(client, channelID, orgID){
  if(!client._channels[channelID]) {
    // let channel = client.newChannel(channelID);
    let channel = new Channel(channelID, client);
    channel.addOrderer(newOrderer());

    channel.getClient = function(){ return this._clientContext; };

    _setupChannelPeers(channel, orgID);
    client._channels[channelID] = channel;
  }
  return client._channels[channelID];
}

/**
 * @param {Channel} channel
 * @param {string} orgID
 * @private
 */
function _setupChannelPeers(channel, orgID) {
  if(!ORGS[orgID]){
    throw new Error('No such organisation: '+orgID);
  }
	for (let peerID in ORGS[orgID]) {
    if(!ORGS[orgID].hasOwnProperty(peerID)){ continue; }

		if (peerID.indexOf('peer') === 0) { // starts with 'peer'

      let peer = _setupPeer(orgID, peerID);
			channel.addPeer(peer);
		}
	}
}

/**
 * similar to {@link newPeer}
 *
 * @param {string} orgID
 * @param {string} peerID
 * @returns {Peer}
 */
function _setupPeer(orgID, peerID){
  let data = fs.readFileSync(path.join(CONFIG_DIR, ORGS[orgID][peerID]['tls_cacerts']));
  let peer = new Peer( ORGS[orgID][peerID].requests,
    {
      pem: Buffer.from(data).toString(),
      'ssl-target-name-override': ORGS[orgID][peerID]['server-hostname']
    }
  );
  return peer;
}


function newOrderer() {
	var caRootsPath = ORGS['orderer'].tls_cacerts;
	let data = fs.readFileSync(path.join(CONFIG_DIR, caRootsPath));
	let caroots = Buffer.from(data).toString();
	return new Orderer(ORGS.orderer.url, {
		'pem': caroots,
		'ssl-target-name-override': ORGS.orderer['server-hostname']
	});
}

function readAllFiles(dir) {
	var files = fs.readdirSync(dir);
	var certs = [];
	files.forEach((file_name) => {
		let file_path = path.join(dir,file_name);
		let data = fs.readFileSync(file_path);
		certs.push(data);
	});
	return certs;
}


/**
 * @param {string} username
 * @param {string} orgID
 * @returns {string}
 */
function getKeyStoreForOrg(username, orgID) {
	return path.join(config.keyValueStore , username + '_' + orgID);
}


/**
 * @param {Array<url>} urls
 * @returns {Array<Peer>}
 */
function newPeers(urls) {
  let targets = [];
  for (let index in urls) {
    if(!urls.hasOwnProperty(index)){ continue; }
    let peerUrl = urls[index];

    try {
      let peer = newPeer(peerUrl);
      targets.push(peer);
    }catch(e) {
      logger.error(e);
    }
  }
  return targets;
}

// /**
//  * @param {Array<url>} urls
//  * @param {string} username
//  * @param {string} org
//  * @returns {Array<EventHub>}
//  */
// function newEventHubs(urls, username, org) {
//   let targets = [];
//   for (let index in urls) {
//     if(!urls.hasOwnProperty(index)){ continue; }
//     let peerUrl = urls[index];
//
//     try {
//       let eh = newEventHub(peerUrl, username, org);
//       targets.push(eh);
//     }catch(e) {
//       logger.error(e);
//     }
//   }
//   return targets;
// }
//

/**
 * @param {url} peerUrl
 * @param {string} [orgID]
 * @returns {object}
 * @private
 */
function _getPeerInfoByUrl(peerUrl, orgID){
  for (let key in ORGS) {
    if (!ORGS.hasOwnProperty(key)) {
      continue;
    }
    if (orgID && key !== orgID) {
      continue;
    }
    // TODO: bookmark issue #9
    if (key === 'orderer') {
      continue;
    }

    let org = ORGS[key];
    for (let prop in org) {
      if (!org.hasOwnProperty(prop)) {
        continue;
      }
      if (prop.indexOf('peer') === 0) {
        if (org[prop]['requests'].indexOf(peerUrl) >= 0) {
          // found a peer matching the subject url
          return org[prop];
        }
      }
    }
  }
  return null;
}

/**
 * @param {url} peerUrl
 * @return {Peer}
 */
function newPeer(peerUrl) {

  var peerInfo = _getPeerInfoByUrl(peerUrl);
  if(!peerInfo) {
    throw new Error('Failed to find a peer matching the url: ' + peerUrl);
  }

  let tls_data = fs.readFileSync(path.join(CONFIG_DIR, peerInfo['tls_cacerts']));
  let peer = new Peer('grpcs://' + peerUrl, {
    pem: Buffer.from(tls_data).toString(),
    'ssl-target-name-override': peerInfo['server-hostname']
  });
  return peer;


}


/**
 * @param {url} peerUrl
 * @param {string} username
 * @param {string} orgID
 * @return {Promise<EventHub>}
 */
function newEventHub(peerUrl, username, orgID) {

  return getClientForOrg(username, orgID)
    .then(client => {
      var peerInfo = _getPeerInfoByUrl(peerUrl, orgID);
      if (!peerInfo) {
        throw new Error('Failed to find a peer matching the url: ' + peerUrl);
      }
      let data = fs.readFileSync(path.join(CONFIG_DIR, peerInfo['tls_cacerts']));

      //
      let eventHub = new EventHub(client);
      eventHub.setPeerAddr(peerInfo['events'], {
        pem: Buffer.from(data).toString(),
        'ssl-target-name-override': peerInfo['server-hostname']
      });
      return eventHub;
    });
}



//-------------------------------------//
// APIs
//-------------------------------------//

/**
 * acquire CLIENT and the CHANNEL for the client! So, both client and channel can be got this way.
 * @param {string} channelID
 * @param {string} username
 * @param {string} orgID
 * @returns {Promise<Channel>}
 */
function getChannelForOrg(channelID, username, orgID) {

  if(!channelID){
    throw new Error('channelID is not set');
  }
  if(!username){
    throw new Error('username is not set');
  }
  if(!orgID){
    throw new Error('orgID is not set');
  }

  return getClientForOrg(username, orgID)
    .then(client=>{
      return _getClientChannel(client, channelID, orgID);
    });
}

// function getChannelAdminForOrg(channelID, orgID) {
//   var adminUser = getAdminCredentials();
//   return getChannelForOrg(channelID, adminUser.username, orgID);
// }


/**
 * get client with user context (WITHOUT CHANNEL, so not really usable
 * @param {string} username
 * @param {string} orgID
 * @returns {Promise<Client>}
 */
function getClientForOrg(username, orgID) {
  if(!username){
    throw new Error('username is not set');
  }
	if(!orgID){
    throw new Error('orgID is not set');
	}
  return _getClientForOrg(username, orgID);
}
//
// /**
//  * @param {string} orgID
//  * @returns {Promise.<Client>}
//  */
// function getAdminClientForOrg(orgID) {
//   if(!orgID){
//     throw new Error('orgID is not set');
//   }
//   var adminUser = getAdminCredentials();
//   return _getClientForOrg(adminUser.username, orgID);
// }

/**
 * @param {string} username
 * @param {string} orgID
 * @returns {Promise.<Client>}
 * @private
 */
function _getClientForOrg(username, orgID) {
  let compositeKey = orgID + '/' + username;
  if(typeof clients[compositeKey] === "undefined"){
    clients[compositeKey] = _initClientForOrg(username, orgID);
  }
  return clients[compositeKey];
}






/**
 * @param {string} org
 * @returns {string}
 */
var getMspID = function(org) {
	logger.debug('Msp ID : ' + ORGS[org].mspid);
	return ORGS[org].mspid;
};

/**
 * @returns {{username:string, password: string}}
 */
function getAdminCredentials(){
  var users = config.users;
  var username = users[0].username;
  var password = users[0].secret;
  return {username:username, password:password};
}
//
// /**
//  * @param {Client} client
//  * @param {string} orgID
//  * @returns {Promise.<User>}
//  */
// function _setClientAdminContext(client, orgID) {
// 	var adminUser = getAdminCredentials();
//   var username = adminUser.username;
//   var password = adminUser.password;
//
// 	return hfc.newDefaultKeyValueStore({
// 		path: getKeyStoreForOrg(username, orgID)
// 	}).then((store) => {
// 		client.setStateStore(store);
// 		// clearing the user context before switching
//
//     // Actually we don't need to clean it, because we cache client instance with user, so there might be only one user here
//     // But it needs to be tested
//     // logger.info('RESET USER CONTEXT 4', client._stateStore._dir);
// 		client._userContext = null;
// 		return client.getUserContext(username, true)
//       .then((user) => {
//         if (user && user.isEnrolled()) {
//           logger.info('Successfully loaded admin "%s" from persistence', username);
//           return user;
//         } else {
//           logger.info('No admin "%s" in persistence', username);
//
//           let caClient = caClients[orgID];
//           // need to enroll it with CA server
//           return caClient.enroll({
//               enrollmentID: username,
//               enrollmentSecret: password
//             }).then((enrollment) => {
//               logger.info('Successfully enrolled admin user "%s"',  username);
//
//               //
//               let member = new User(username);
//               member.setCryptoSuite(client.getCryptoSuite());
//               return member.setEnrollment(enrollment.key, enrollment.certificate, getMspID(orgID)).then(()=>member);
//             }).then((user) => {
//               return client.setUserContext(user);
//             }).catch((err) => {
//               logger.error('Failed to enroll and persist admin user "%s". Error: ', err && err.message || err);
//               // doesn't need full stack trace here, because we throw an error
//               throw err;
//             });
//         }
//       });
// 	});
// }

/**
 * Perform login with the user.
 * It uses private key for the user, which is set in key-value storage {@see getKeyStoreForOrg}
 * So, if the user exist in the storage, we can pick it up and use.
 * If not - there is no way to fetch it from CA (because we need user private key, which should be never passed to CA).
 *
 * It's actually a LOGIN operation.
 * We need to TAKE INTO ACCOUNT that "client.getUserContext(username, true)" updates 'client._userContext',
 *   so, we left all 'client.setUserContext(user)' operations here as well
 *
 *
 * @param {Client} client
 * @param {string} username
 * @param {string} orgID
 * @returns {Promise.<User>}
 */
function _setClientUserContext(client, username, orgID) {

	return hfc.newDefaultKeyValueStore({
		path: getKeyStoreForOrg(username, orgID)
	}).then((store) => {
		client.setStateStore(store);
		// clearing the user context before switching
    // Actually we don't need to clean it, because we cache client instance with user, so there might be only one user here
		client._userContext = null;

		return client.getUserContext(username, true) // MAY UPDATE _userContext
      .then((user) => {
        if (user && user.isEnrolled()) {
          logger.info('Successfully loaded member "%s" from persistence', username);
          return user;
        } else {
          logger.info('No member "%s" in persistence', username);

          let caClient = getCAClient(orgID);
          var enrollmentSecret = null;
          return getClientAdmin(orgID)
            .then(function(adminUserObj) {
              return caClient.register({
                enrollmentID: username,
                affiliation: orgID + '.department1'
              }, adminUserObj);
            }).then((secret) => {
              enrollmentSecret = secret;
              logger.debug('Successfully registered member "%s":',  username, enrollmentSecret);
              return caClient.enroll({
                enrollmentID: username,
                enrollmentSecret: secret
              });
            }).then((message) => {
              if (message && typeof message === 'string' && message.includes('Error:')) {
                logger.error('Fail to enroll member "%s"',  username, message);
                throw new Error(message);
              }
              logger.info('Successfully enrolled member "%s"',  username);

              //
              let member = new User(username);
              member._enrollmentSecret = enrollmentSecret;
              return member.setEnrollment(message.key, message.certificate, getMspID(orgID)).then(()=>member);
            })
            .then((user) => {
              return client.setUserContext(user);
            })
            .catch((err) => {
              logger.error('Failed to enroll and persist member user "%s". Error: ', username, err && err.message || err);
              // doesn't need full stack trace here, because we throw an error
              throw err;
            });
        }
    });
	})
  .catch(function(err) {
    logger.error('Failed to get registered user: %s, error:', username, err && err.message || err);
    var errData = _extractEnrolmentError(err.message || err);
    if(errData.code === 0){ // assume code "0" can be on "already registered" error
      // User is already registered, but we cannot find the private key for it.
      // It seems that we lost access forever
      throw new Error("User key is not found in the storage");
    }
    throw errData;
  })

    // HOTFIX
  .catch(function(/*e*/){
    logger.warn('HOTFIX: use admin credentials instead of user "%s"', username);
    return _setClientAdminContext2(client, orgID)
      .then((user) => {
        return client.setUserContext(user);
      });
  });
}


/**
 * @param {string} username
 * @return {boolean}
 */
function isAdmin(username){
  var adminUser = getAdminCredentials();
  return adminUser.username === username;
}

// /**
//  * @param {string} orgID
//  * @returns {Promise.<User>}
//  */
// function getOrgAdmin(orgID) {
//
//   var adminUser = getAdminCredentials();
//   var username = adminUser.username;
//
//   return getClientForOrg(username, orgID)
//     .then(client=>{
//
//       // admin certificates
//       // TODO: explicitly set files
//       var adminCerificates = ORGS[orgID].admin;
//       var keyPath = path.join(CONFIG_DIR, adminCerificates.key);
//       var keyPEM = Buffer.from(readAllFiles(keyPath)[0]).toString();
//       var certPath = path.join(CONFIG_DIR, adminCerificates.cert);
//       var certPEM = readAllFiles(certPath)[0].toString();
//
//
//       // also call 'setUserContext()' inside
//       return client.createUser({
//         username: 'peer'+orgID+'Admin', // TODO:
//         mspid: getMspID(orgID),
//         cryptoContent: {
//           privateKeyPEM: keyPEM,
//           signedCertPEM: certPEM
//         }
//       });
//       //   .then((user) => {
//       //   return client.setUserContext(user);
//       // })
//     });
// }


/**
 * @param {Client} client
 * @param {string} orgID
 * @returns {Promise.<User>}
 */
function _setClientAdminContext2(client, orgID) {

  var adminUser = getAdminCredentials();
  var username = adminUser.username;

  return hfc.newDefaultKeyValueStore({
    path: getKeyStoreForOrg(username, orgID)
  }).then((store) => {
      client.setStateStore(store);

      // admin certificates
      // TODO: explicitly set files
      var adminCerificates = ORGS[orgID].admin;
      var keyPath = path.join(CONFIG_DIR, adminCerificates.key);
      var keyPEM = Buffer.from(readAllFiles(keyPath)[0]).toString();
      var certPath = path.join(CONFIG_DIR, adminCerificates.cert);
      var certPEM = readAllFiles(certPath)[0].toString();


      // also call 'setUserContext()' inside
      return client.createUser({
        username: 'peer'+orgID+'Admin', // TODO:
        mspid: getMspID(orgID),
        cryptoContent: {
          privateKeyPEM: keyPEM,
          signedCertPEM: certPEM
        }
      });
      //   .then((user) => {
      //   return client.setUserContext(user);
      // })
  });
}



/**
 * @param {string} errorString
 * @return {{code:number|null, message:string}}
 * @example Error: fabric-ca request register failed with errors [[{"code":0,"message":"Identity 'admin' is already registered"}]]
 * @private
 */
function _extractEnrolmentError(errorString){
  var m = (''+errorString).match(/\[\[(.*)\]\]/);
  if(m){
    var data;
    try{
      data = JSON.parse(m[1]);
    }catch(e){
      data = {code: null, message : m[1]};
    }
    return data;
  } else{
    return {code: null, message : errorString};
  }
}



var setupChaincodeDeploy = function() {
	process.env.GOPATH = path.join(CONFIG_DIR, config.GOPATH);
};

var getLogger = function(moduleName) {
	var logger = log4js.getLogger(moduleName);
	logger.setLevel('DEBUG');
	return logger;
};

var getPeerAddressByName = function(org, peer) {
	// console.log(ORGS);
	// console.log(org, peer);
	var address = ORGS[org][peer].requests;
	return address.split('grpcs://')[1];
};

exports.getClientForOrg  = getClientForOrg;
// exports.getAdminClientForOrg  = getAdminClientForOrg;

exports.getClientUser = getClientUser;
// exports.getOrgAdmin = getClientAdmin;

// use channel._clientContext to get a client
exports.getChannelForOrg = getChannelForOrg;
// exports.getChannelAdminForOrg = getChannelAdminForOrg;

exports.getLogger = getLogger;
exports.setupChaincodeDeploy = setupChaincodeDeploy;
exports.getMspID = getMspID;
exports.ORGS = ORGS;
exports.CONFIG_DIR = CONFIG_DIR;
exports.newPeers = newPeers;
// exports.newEventHubs = newEventHubs;
exports.newPeer = newPeer;
exports.newEventHub = newEventHub;

exports.getPeerAddressByName = getPeerAddressByName;
exports._extractEnrolmentError = _extractEnrolmentError;
