(function() {
  goog.provide('ga_featuretree_directive');

  goog.require('ga_map_service');
  goog.require('ga_styles_service');

  var module = angular.module('ga_featuretree_directive', [
    'ga_map_service',
    'ga_styles_service',
    'pascalprecht.translate'
  ]);

  module.directive('gaFeaturetree',
      function($rootScope, $compile, $timeout, $http, $q, $translate, $sce,
               gaLayers, gaDefinePropertiesForLayer, gaStyleFunctionFactory, 
               gaMapClick) {

        var createVectorLayer = function(style) {
          var vector = new ol.layer.Vector({
                styleFunction: gaStyleFunctionFactory(style),
                source: new ol.source.Vector()
              });
          gaDefinePropertiesForLayer(vector);
          vector.highlight = true;
          vector.invertedOpacity = 0.25;
          return vector;
        };

        return {
          restrict: 'A',
          replace: true,
          templateUrl: 'components/featuretree/partials/featuretree.html',
          scope: {
            options: '=gaFeaturetreeOptions',
            map: '=gaFeaturetreeMap'
          },
          link: function(scope, element, attrs) {
            var currentTopic;
            var timeoutPromise = null;
            var canceler = null;
            var map = scope.map;
            var view = map.getView();
            var viewport = $(map.getViewport());
            var projection = view.getProjection();
            var objectInfoToggleEl = $('#object-info-toggle');
            var objectInfoParentEl = $('#object-info-parent');
            var objectInfo = {};
            var parser = new ol.format.GeoJSON();
            var hlLayer = createVectorLayer('highlight');
            var selectLayer = createVectorLayer('select');
            var rectangleLayer = createVectorLayer('lightselect');
            //FIXME improve the drawing. Right now is very simple
            var firstPoint;
            rectangleLayer.invertedOpacity = 0.25;
            map.addLayer(hlLayer);
            map.addLayer(selectLayer);

            objectInfo.html = '';
            objectInfo.loading = false;
            $rootScope.objectinfo = objectInfo;

            $compile($('#object-info-target')[0])($rootScope);

            var getLayersToQuery = function(layers) {
              var layerstring = '';
              map.getLayers().forEach(function(l) {
                  var id = l.get('bodId');
                  if (gaLayers.getLayer(id) &&
                      gaLayers.getLayerProperty(id, 'queryable')) {
                    if (layerstring.length) {
                      layerstring = layerstring + ',';
                    }
                    layerstring = layerstring + id;
                  }
              });
              return layerstring;
            };

            var cancel = function() {
              if (timeoutPromise !== null) {
                $timeout.cancel(timeoutPromise);
              }
              if (canceler !== null) {
                canceler.resolve();
              }
              scope.loading = false;
              canceler = $q.defer();
            };

            var parseBoxString = function(stringBox2D) {
              var extent = stringBox2D.replace('BOX(', '')
                .replace(')', '').replace(',', ' ')
                .split(' ');
              return $.map(extent, parseFloat);
            };

            var updateTree = function(res, searchExtent) {
              var tree = {}, i, li, j, lj, layerId, newNode, oldNode,
                  feature, oldFeature, result, bbox, ext;
              if (res.results &&
                  res.results.length > 0) {

                for (i = 0, li = res.results.length; i < li; i++) {
                  result = res.results[i];

                  // The feature search using sphinxsearch uses quadindex
                  // to filter results based on their bounding boxes. This is
                  // in order to make the search extremely fast even for a large
                  // number of features. The downside is that we will have false
                  // positives in the results (features which are outside of
                  // the searched box). Here, we filter out those false
                  // positives based on the bounding box of the feature. Note
                  // that we could refine this by using the exact geometry in
                  // the future
                  if (result.attrs.geom_st_box2d) {
                    bbox = parseBoxString(result.attrs.geom_st_box2d);
                    ext = ol.extent.boundingExtent([[bbox[0], bbox[1]],
                                                       [bbox[2], bbox[3]]]);
                    if (ol.extent.getArea(ext) <= 0) {
                      if (!ol.extent.containsCoordinate(searchExtent,
                                                        [ext[0], ext[1]])) {
                        continue;
                      }
                    } else if (ol.extent.getIntersectionArea(searchExtent,
                                                      ext) <= 0) {
                      continue;
                    }
                  }

                  layerId = result.attrs.layer;
                  newNode = tree[layerId];
                  oldNode = scope.tree[layerId];
                  feature = undefined;

                  if (!angular.isDefined(newNode)) {
                    newNode = {
                      label: gaLayers.getLayer(layerId).label,
                      features: [],
                      open: oldNode ? oldNode.open : false
                    };
                    tree[layerId] = newNode;
                  }

                  //look if feature exists already. We do this
                  //to avoid loading the same feature again and
                  //again
                  if (oldNode) {
                    for (j = 0, lj = oldNode.features.length; j < lj; j++) {
                      oldFeature = oldNode.features[j];
                      if (oldFeature.id === result.attrs.id) {
                        feature = oldFeature;
                        break;
                      }
                    }
                  }
                  if (!angular.isDefined(feature)) {
                    feature = {
                      info: '',
                      geometry: null,
                      id: result.attrs.id,
                      layer: layerId,
                      label: result.attrs.label
                    };
                  }
                  newNode.features.push(feature);
                  loadAndDrawGeometry(feature, selectLayer);
                }
              }
              scope.tree = tree;
            };

            var getSearchExtent = function() {
              if (scope.searchmode === 'rectangle') {
                return ol.extent.boundingExtent(
                    scope.searchRectangle.getCoordinates());
              }
              return view.calculateExtent(map.getSize());
            };

            var getUrlAndParameters = function(layersToQuery, extent) {
              var url = scope.options.searchUrlTemplate,
                  params = {
                    bbox: extent[0] + ',' + extent[1] +
                        ',' + extent[2] + ',' + extent[3],
                    type: 'features',
                    features: layersToQuery
                  };
              url = url.replace('{Topic}', currentTopic);
              return {
                url: url,
                params: params
              };
            };

            var requestFeatures = function() {
              var layersToQuery = getLayersToQuery(),
                  req, searchExtent;
              selectLayer.getSource().clear();
              hlLayer.getSource().clear();
              if (layersToQuery.length) {
                searchExtent = getSearchExtent();
                req = getUrlAndParameters(layersToQuery, searchExtent);

                scope.loading = true;

                // Look for all features in current bounding box
                $http.get(req.url, {
                  timeout: canceler.promise,
                  params: req.params
                }).success(function(res) {
                  updateTree(res, searchExtent);
                  scope.loading = false;
                }).error(function(reason) {
                  scope.tree = {};
                  scope.loading = false;
                });
              }
            };

            // Update the tree based on map changes. We use a timeout in
            // order to not trigger angular digest cycles and too many
            // updates. We don't use the permalink here because we want
            // to separate these concerns.
            var triggerChange = function(delay) {
              var to = delay;
              if (angular.isDefined(to)) {
                to = 300;
              }
              if (scope.options.active) {
                cancel();
                timeoutPromise = $timeout(function() {
                  requestFeatures();
                  timeoutPromise = null;
                }, to);
              }
            };

            var assureLayerOnTop = function(layer) {
              map.removeLayer(layer);
              map.addLayer(layer);
            };

            var drawGeometry = function(geometry, layer) {
              if (geometry) {
                parser.readObject(geometry,
                                  layer.getSource().addFeature,
                                  layer.getSource());
                assureLayerOnTop(layer);
              }
            };

            var loadAndDrawGeometry = function(feature, layer) {
              //Load geometry and display it
              var featureUrl;
              if (!feature.geometry) {
                featureUrl = scope.options.htmlUrlTemplate
                             .replace('{Topic}', currentTopic)
                             .replace('{Layer}', feature.layer)
                             .replace('{Feature}', feature.id)
                             .replace('/htmlpopup', '');
                $http.get(featureUrl, {
                  timeout: canceler.promise,
                  params: {
                    geometryFormat: 'geojson'
                  }
                }).success(function(result) {
                  feature.geometry = result.feature;
                  drawGeometry(feature.geometry, layer);
                }).error(function() {
                  feature.geometry = null;
                  drawGeometry(null, layer);
                });
              } else {
                drawGeometry(feature.geometry, layer);
              }
            };

            scope.searchmode = 'auto';
            scope.searchRectangle = new ol.geom.LineString([
              [590000, 190000],
              [590000, 210000],
              [610000, 210000],
              [610000, 190000],
              [590000, 190000]
            ]);
            rectangleLayer.getSource().addFeature(
                new ol.Feature(scope.searchRectangle));
            scope.loading = false;
            scope.tree = {};

            scope.showFeatureInfo = function(feature) {
              var htmlUrl;

              if (!objectInfoParentEl.hasClass('open')) {
                objectInfoToggleEl.dropdown('toggle');
              }

              //Load information if not already there
              if (feature.info == '') {
                objectInfo.loading = true;
                htmlUrl = scope.options.htmlUrlTemplate
                          .replace('{Topic}', currentTopic)
                          .replace('{Layer}', feature.layer)
                          .replace('{Feature}', feature.id);
                $http.get(htmlUrl, {
                  timeout: canceler.promise,
                  params: {
                    lang: $translate.uses()
                  }
                }).success(function(html) {
                  feature.info = $sce.trustAsHtml(html);
                  objectInfo.html = feature.info;
                  objectInfo.loading = false;
                }).error(function() {
                  feature.info = '';
                  objectInfo.html = feature.info;
                  objectInfo.loading = false;
                });
              } else {
                objectInfo.html = feature.info;
              }
              hlLayer.getSource().clear();
              loadAndDrawGeometry(feature, hlLayer);
            };

            view.on('change', function() {
              if (scope.searchmode === 'auto') {
                triggerChange();
              }
            });

            scope.$on('gaTopicChange', function(event, topic) {
              currentTopic = topic.id;
            });

            scope.$watch('options.active', function(newVal, oldVal) {
              cancel();
              if (newVal === true) {
                requestFeatures();
              }
            });

            var updateRectangle = function(evt) {
              var coordinate = (evt.originalEvent) ?
                  map.getEventCoordinate(evt.originalEvent) :
                  evt.getCoordinate();
              scope.searchRectangle.setCoordinates([
                [firstPoint[0], firstPoint[1]],
                [firstPoint[0], coordinate[1]],
                [coordinate[0], coordinate[1]],
                [coordinate[0], firstPoint[1]],
                [firstPoint[0], firstPoint[1]]
              ]);
            };

            var resetRectangleDrawing = function() {
              firstPoint = undefined;
              viewport.unbind('mousemove', updateRectangle);
            };

            scope.$watch('searchmode', function(newVal, oldVal) {
              if (newVal !== oldVal) {
                resetRectangleDrawing();
                if (newVal === 'rectangle') {
                  map.addLayer(rectangleLayer);
                } else {
                  map.removeLayer(rectangleLayer);
                }
                triggerChange(0);
              }
            });

            gaMapClick.listen(map, function(evt) {
              var coordinate;
              if (scope.searchmode === 'rectangle') {
                coordinate = (evt.originalEvent) ?
                    map.getEventCoordinate(evt.originalEvent) :
                    evt.getCoordinate();
                if (!angular.isDefined(firstPoint) &&
                    evt.browserEvent.ctrlKey) {
                    firstPoint = coordinate;
                    viewport.on('mousemove', updateRectangle);
                } else if (angular.isDefined(firstPoint)) {
                  updateRectangle(evt);
                  resetRectangleDrawing();
                  triggerChange(0);
                }
              }
            });

          }
        };

      }
  );
})();

