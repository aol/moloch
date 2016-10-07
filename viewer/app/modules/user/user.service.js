(function() {

  'use strict';

  /**
   * @class UserService
   * @classdesc Transacts users with the server
   */
  class UserService {

    /**
     * Initialize global variables for the UserService
     * @param $q    Service to run functions asynchronously
     * @param $http Angular service that facilitates communication
     *              with the remote HTTP servers
     *
     * @ngInject
     */
    constructor($q, $http) {
      this.$q     = $q;
      this.$http  = $http;
    }

    /* service methods ----------------------------------------------------- */
    /**
     * Gets current users from the server
     * @returns {Promise} Promise A promise object that signals the completion
     *                            or rejection of the request.
     */
    getCurrent() {
      return this.$q((resolve, reject) => {

        this.$http({ url:'currentuser', method:'GET', cache:true })
          .then((response) => {
            resolve(response.data);
          }, (error) => {
            reject(error);
          });

      });
    }

    hasPermission(priv) {
      return this.$q((resolve, reject) => {

        this.getCurrent()
          .then((user) => {
            resolve(user[priv]);
          }, (error) => {
            reject(error);
          });

      });
    }

  }

  UserService.$inject = ['$q', '$http'];


  angular.module('moloch')
    .service('UserService', UserService);

})();
