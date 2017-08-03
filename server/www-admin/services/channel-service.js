/**
 * @class ChannelService
 * @classdesc
 * @ngInject
 */
function ChannelService(ApiService, $q) {

  // jshint shadow: true
  var ChannelService = this;

  /**
   */
  ChannelService.list = function(user) {
    return ApiService.channels.list();
  };


  /**
   */
  ChannelService.listChaincodes = function() {
    return ApiService.chaincodes.list();
  };



  /**
   * @param {string} blockHash
   */
  ChannelService.getLastBlock = function(channelId, blockHash) {
    return ApiService.channels.get(channelId)
      .then(function(currentBlockHash){
        if(!currentBlockHash){
          return $q.resolve(null);
        }
        return ApiService.channels.getBlock(channelId, currentBlockHash);
      });
  };

  ChannelService.getTransactionById = function(txId){
    if(!txId){
      return $q.resolve(null);
    }
    return ApiService.transaction.getById(txId);
  };

  /**
   * sample invoke operation
   * @param {string} from
   * @param {string} to
   * @param {string} amount
   */
  ChannelService.scMove = function(from, to, amount){
    return ApiService.sc.invoke('mychannel', 'mycc', 'move', [from, to, amount]);
  };

  /**
   * @param {string} channelId
   * @param {string} contractId
   * @param {Array<string>} peers - peersId
   * @param {string} fcn
   * @param {Array} [args]
   */
  ChannelService.invoke = function(channelId, contractId, peers, fcn, args){
    return ApiService.sc.invoke(channelId, contractId, peers, fcn, args);
  };

  /**
   * @param {string} channelId
   * @param {string} contractId
   * @param {string} peer - peerId
   * @param {string} fcn
   * @param {Array} [args]
   */
  ChannelService.query = function(channelId, contractId, peer, fcn, args){
    return ApiService.sc.query(channelId, contractId, peer, fcn, args);
  };

}

angular.module('nsd.service.channel', ['nsd.service.api'])
  .service('ChannelService', ChannelService);