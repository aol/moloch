(function() {

  'use strict';

  // local variable to save query state
  let _query = {  // set query defaults:
    length: 50,   // page length
    start : 0,    // first item index
    facets: 1,    // facets
    spi   : 'a2:100,prot-term:100,a1:100' // which spi data values to query for
  };

  /**
   * @class SpiviewController
   * @classdesc Interacts with moloch spiview page
   * @example
   * '<moloch-spiview></moloch-spiview>'
   */
  class SpiviewController {

    /* setup --------------------------------------------------------------- */
    /**
     * Initialize global variables for this controller
     * @param $scope          Angular application model object
     * @param $location       Exposes browser address bar URL (based on the window.location)
     * @param $routeParams    Retrieve the current set of route parameters
     * @param UserService     Transacts users and user data with the server
     * @param FieldService    Retrieves available fields from the server
     * @param SpiviewService  Transacts spiview data with the server
     * @ngInject
     */
    constructor($scope, $location, $routeParams,
      UserService, FieldService, SpiviewService) {
      this.$scope         = $scope;
      this.$location      = $location;
      this.$routeParams   = $routeParams;
      this.UserService    = UserService;
      this.FieldService   = FieldService;
      this.SpiviewService = SpiviewService;
    }

    /* Callback when component is mounted and ready */
    $onInit() {
      this.loading  = true;
      this.query    = _query; // load saved query

      if (this.$routeParams.spi) {
        // if there's a spi param use it
        this.query.spi = _query.spi = this.$routeParams.spi;
      } else { // if there isn't, set it for future use
        this.$location.search('spi', this.query.spi);
      }

      this.getFields(); // IMPORTANT: kicks off initial query for spi data!
      this.getUserSettings();

      let initialized;
      this.$scope.$on('change:search', (event, args) => {
        // either (startTime && stopTime) || date
        if (args.startTime && args.stopTime) {
          _query.startTime  = this.query.startTime  = args.startTime;
          _query.stopTime   = this.query.stopTime   = args.stopTime;
          _query.date       = this.query.date       = null;
        } else if (args.date) {
          _query.date       = this.query.date       = args.date;
          _query.startTime  = this.query.startTime  = null;
          _query.stopTime   = this.query.stopTime   = null;
        }

        _query.expression = this.query.expression = args.expression;
        if (args.bounding) {_query.bounding = this.query.bounding = args.bounding;}

        this.query.view = args.view;

        // don't issue search when the first change:search event is fired
        if (!initialized) { initialized = true; return; }

        this.getFields();
      });

      // watch for additions to search parameters from spi values
      this.$scope.$on('add:to:search', (event, args) => {
        // notify children (namely expression typeahead)
        this.$scope.$broadcast('add:to:typeahead', args);
      });

      // watch for changes to time parameters from graph
      this.$scope.$on('change:time', (event, args) => {
        // notify children (namely search component)
        this.$scope.$broadcast('update:time', args);
      });
    }


    /* data retrieve/setup/update ------------------------------------------ */
    /* Retrieves the list of fields from the server and groups them into
     * categories, then kicks of the query for spi data */
    getFields() {
      this.loading = true;

      this.FieldService.get(true)
        .then((response) => {
          this.error = false;
          this.fields = response;
          this.categoryObjects = {};

          for (let i = 0, len = this.fields.length; i < len; ++i) {
            let field = this.fields[i];
            if (this.categoryObjects.hasOwnProperty(field.group)) {
              // already created, just add a new field
              this.categoryObjects[field.group].fields.push(field);
            } else { // create it
              this.categoryObjects[field.group] = { fields: [ field ] };
            }
          }

          this.getSpiData(); // IMPORTANT: queries for spi data!
        })
        .catch((error) => {
          this.loading  = false;
          this.error    = error.text;
        });
    }

    /* Retrieves spiview data from the server and puts each piece of data into
     * it's appropriate category */
    getSpiData() {
      this.SpiviewService.get(this.query)
        .then((response) => {
          this.loading  = false;
          this.error    = false;

          this.spi        = response.spi;
          this.mapData    = response.map;
          this.graphData  = response.graph;
          this.protocols  = response.protocols;
          this.total      = response.recordsTotal;
          this.filtered   = response.recordsFiltered;

          for (let key in this.protocols) {
            if (this.protocols.hasOwnProperty(key)) {

              let category;

              if (this.categoryObjects.hasOwnProperty(key)) {
                category = this.categoryObjects[key];
              } else { // categorize special protocols that don't match category
                if (key === 'tcp' || key === 'udp' || key === 'icmp') {
                  category = this.categoryObjects.general;
                } else if (key === 'smtp' || key === 'lmtp') {
                  category = this.categoryObjects.email;
                }
              }

              if (category) {
                if (category.protocols) { // already created, just add new
                  category.protocols.push({ name:key, value:this.protocols[key] });
                } else { // create protocols object
                  category.protocols = [{ name:key, value:this.protocols[key] }];
                }
              }

            }
          }

          for (let key in this.spi) {
            if (this.spi.hasOwnProperty(key)) {
              for (let f in this.fields) {
                if (this.fields.hasOwnProperty(f)) {
                  let field = this.fields[f];
                  if (field.dbField === key) { // found the field!
                    let spi = this.spi[key];
                    let category = this.categoryObjects[field.group];
                    if (category) { // found the category it belongs to
                      if (!category.spi)  { category.spi = {}; }
                      category.spi[key] = { field:field, value:spi, active:true };
                    }
                  }
                }
              }
            }
          }

          for (let key in this.categoryObjects) {
            if (this.categoryObjects.hasOwnProperty(key)) {
              if (localStorage && localStorage['spiview-collapsible']) {
                if (localStorage['spiview-collapsible'].contains(key)) {
                  this.categoryObjects[key].isopen = true;
                }
              }
            }
          }
        })
        .catch((error) => {
          this.loading  = false;
          this.error    = error.text;
        });
    }

    /* Retrieves the current user's settings (specifically for timezone) */
    getUserSettings() {
      this.UserService.getSettings()
      .then((settings) => {
        this.settings = settings;
      })
      .catch((error) => {
        this.error = error;
      });
    }


    /* exposed functions --------------------------------------------------- */
    /**
     * Toggles the view of field spi data by updating the query.spi string
     * @param {string} fieldID    The id (dbField) of the field to toggle
     * @param {string} fieldGroup The group/category the field belongs to
     */
    toggleSpiData(fieldID, fieldGroup) {
      // let spiData = this.categoryObjects[fieldGroup].spi[fieldID];
      let spiData;
      if (this.categoryObjects[fieldGroup].spi) {
        spiData = this.categoryObjects[fieldGroup].spi[fieldID];
      }

      let addField = false;

      if (this.query.spi.contains(fieldID)) {
        // remove this field's spi data
        let split = this.query.spi.split(',');
        for (let i = 0, len = split.length; i < len; ++i) {
          if (split[i].contains(fieldID)) {
            split.splice(i, 1);
            break;
          }
        }
        this.query.spi = split.join(',');

        if (spiData) { spiData.active = false; }
      } else { // add this field's spi data
        if (this.query.spi && this.query.spi !== '') {
          this.query.spi += ',';
        }
        this.query.spi += `${fieldID}:100`;

        if (!spiData) { addField = true; }
        else          { spiData.active = true; }
      }

      _query.spi = this.query.spi;
      this.$location.search('spi', this.query.spi); // update url param

      // issue query if user has added a field (need more info)
      if (addField) { this.getFields(); }
    }

    /**
     * Saves the open categories to spiview-collapsible localStorage
     * @param {string} name   The name of the category
     * @param {bool} isclosed Whether the category is closed
     */
    toggleCategory(name, isclosed) {
      if (localStorage) {
        if (localStorage['spiview-collapsible']) {
          let visiblePanels = localStorage['spiview-collapsible'];
          if (isclosed) {
            let split = visiblePanels.split(',');
            for (let i = 0, len = split.length; i < len; ++i) {
              if (split[i].contains(name)) {
                split.splice(i, 1);
                break;
              }
            }
            visiblePanels = split.join(',');
          } else {
            if (!visiblePanels.contains(name)) {
              if (visiblePanels !== '') { visiblePanels += ','; }
              visiblePanels += `${name}`;
            }
          }
          localStorage['spiview-collapsible'] = visiblePanels;
        } else {
          localStorage['spiview-collapsible'] = name;
        }
      }
    }

  }

  SpiviewController.$inject = ['$scope','$location','$routeParams',
    'UserService','FieldService','SpiviewService'];

  /**
   * SPI View Directive
   * Displays SPI View page
   */
  angular.module('moloch')
  .component('molochSpiview', {
    template  : require('html!./spiview.html'),
    controller: SpiviewController
  });

})();
