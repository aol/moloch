(function() {

  'use strict';

  var initialized = false;

  angular.module('moloch')

    /**
     * Moloch Session Graph Directive
     * uses Angular Flot
     *
     * @example
     * <session-graph graph-data="$ctrl.graphData"></session-graph>
     */
    .directive('sessionGraph', ['$filter', '$timeout', '$document',
      function($filter, $timeout, $document) {
      return {
        template: require('html!../templates/graph.html'),
        scope   : { graphData: '=', type: '@' },
        link    : function(scope, element, attrs) {

          /* internal functions -------------------------------------------- */
          var timeout;
          function debounce(func, funcParam, ms) {
            if (timeout) { $timeout.cancel(timeout); }

            timeout = $timeout(() => {
              func(funcParam);
            }, ms);
          }

          function updateResults(graph) {
            var xAxis = graph.getXAxes();

            var result = {
              start : (xAxis[0].min / 1000).toFixed(),
              stop  : (xAxis[0].max / 1000).toFixed()
            };

            if (result.start && result.stop) {
              scope.$emit('change:time', result);
            }
          }

          function setup(data) {
            scope.graph         = [{ data:data[scope.type] }];

            scope.graphOptions  = { // flot graph options
              series  : {
                bars  : {
                  show: true,
                  fill: 1,
                  barWidth: (data.interval * 1000) / 1.7
                },
                color : '#66057A'
              },
              selection : {
                mode    : 'x',
                color   : '#333333'
              },
              xaxis   : {
                mode  : 'time',
                label : 'Datetime',
                color : '#777',
                min   : data.xmin || null,
                max   : data.xmax || null,
                tickFormatter: function(v, axis) {
                  return $filter('date')(v, 'yyyy/MM/dd HH:mm:ss');
                }
              },
              yaxis   : {
                min   : 0,
                color : '#777',
                zoomRange       : false,
                autoscaleMargin : 0.2,
                tickFormatter   : function(v, axis) {
                  return $filter('commaString')(v);
                }
              },
              grid          : {
                borderWidth : 0,
                color       : '#777',
                hoverable   : true,
                clickable   : true
              },
              zoom          : {
                interactive : false,
                trigger     : 'dblclick',
                amount      : 2
              },
              pan           : {
                interactive : false,
                cursor      : 'move',
                frameRate   : 20
              }
            };
          }


          /* setup --------------------------------------------------------- */
          if (!scope.type) { scope.type = 'lpHisto'; } // default data type

          // setup the graph data and options
          setup(scope.graphData);

          // create flot graph
          var plotArea  = element.find('.plot-area');
          var plot      = $.plot(plotArea, scope.graph, scope.graphOptions);


          /* LISTEN! */
          // watch for graph data to change to update the graph
          scope.$watch('graphData', (data) => {
            if (initialized) {
              setup(data); // setup scope.graph and scope.graphOptions

              plot = $.plot(plotArea, scope.graph, scope.graphOptions);
            } else {
              initialized = true;
            }
          });

          // triggered when an area of the graph is selected
          plotArea.on('plotselected', function (event, ranges) {
            var result = {
              start : (ranges.xaxis.from / 1000).toFixed(),
              stop  : (ranges.xaxis.to / 1000).toFixed()
            };

            if (result.start && result.stop) {
              scope.$emit('change:time', result);
            }
      		});

          var previousPoint, body = $document[0].body;
          // triggered when hovering over the graph
          plotArea.on('plothover', function(event, pos, item) {
            if (item) {
              if (previousPoint !== item.dataIndex) {
                previousPoint = item.dataIndex;

                $(body).find('#tooltip').remove();

                var y = $filter('commaString')(Math.round(item.datapoint[1]*100)/100);
                var d = $filter('date')(item.datapoint[0].toFixed(0),
                                        'yyyy/MM/dd HH:mm:ss');

                var tooltipHTML = `<div id="tooltip" class="graph-tooltip">
                                    ${y} at ${d}</div>`;

                $(tooltipHTML).css({
                  top : item.pageY - 30,
                  left: item.pageX - 8
                }).appendTo(body);
              }
            } else {
              $(body).find('#tooltip').remove();
              previousPoint = null;
            }
          });

          scope.$on('update:histo:type', (event, newType) => {
            if (scope.type !== newType) {
              scope.type = newType;
              scope.graph = [{data: scope.graphData[scope.type]}];

              plot.setData(scope.graph);
              plot.setupGrid();
              plot.draw();
            }
          });


          /* exposed functions --------------------------------------------- */
          scope.changeHistoType = function() {
            scope.graph = [{ data:scope.graphData[scope.type] }];

            plot.setData(scope.graph);
            plot.setupGrid();
            plot.draw();

            scope.$emit('change:histo:type', scope.type);
          };

          scope.zoomOut = function() {
            plot.zoomOut();
            debounce(updateResults, plot, 400);
          };

          scope.zoomIn = function() {
            plot.zoom();
            debounce(updateResults, plot, 400);
          };

          scope.panLeft = function() {
            plot.pan({left: -100});
            debounce(updateResults, plot, 400);
          };

          scope.panRight = function() {
            plot.pan({left: 100});
            debounce(updateResults, plot, 400);
          };


          /* cleanup ------------------------------------------------------- */
          element.on('$destroy', function onDestroy () {
            plotArea.off('plothover');
            plotArea.off('plotselected');
          });

        }
      };
    }]);

})();
