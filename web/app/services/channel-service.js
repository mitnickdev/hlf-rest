/**
 * @class ChannelService
 * @classdesc
 * @ngInject
 */
function ChannelService(ApiService) {

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
  ChannelService.getLastBlock = function(blockHash) {
    var channelId = 'mychannel';
    return ApiService.channels.get(channelId)
      .then(function(currentBlockHash){
        return ApiService.channels.getBlock(channelId, currentBlockHash);
      });
  };

  ChannelService.getTransactionById = function(txId){
    return ApiService.transaction.getById(txId);
  };

  /**
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
   * @param {string} fcn
   * @param {Array} [args]
   */
  ChannelService.invoke = function(channelId, contractId, fcn, args){
    return ApiService.sc.invoke(channelId, contractId, fcn, args);
  };

}

angular.module('nsd.service.channel', ['nsd.service.api'])
  .service('ChannelService', ChannelService);