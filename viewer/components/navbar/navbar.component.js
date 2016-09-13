(function() {

  'use strict';

  /**
   * @class NavbarController
   * @classdesc Interacts with the navbar
   * @example
   * '<navbar></navbar>'
   */
  class NavbarController {

    /**
     * Initialize global variables for this controller
     * @param $location Exposes browser address bar URL
     *                  (based on the window.location)
     *
     * @ngInject
     */
    constructor($location) {
      this.$location = $location;
    }

    /* Callback when component is mounted and ready */
    $onInit() {
      this.menu = {
        session : { title: 'Sessions', link: '/app#/session' }
      };
    }


    /* exposed functions --------------------------------------------------- */
    /**
     * Determines the active nav item based on the page route
     * @param {string} route The route of the nav item
     */
    isActive(route) {
      return route === '/app#' + this.$location.path();
    }

  }

  NavbarController.$inject = ['$location'];

  /**
   * Navbar Directive
   * Displays the navbar
   */
  angular.module('directives.navbar', [])
    .component('navbar', {
      template  : require('html!./navbar.html'),
      controller: NavbarController
    });

})();
