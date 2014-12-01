///ts:ref=Mask
/// <reference path="./Mask.ts"/> ///ts:ref:generated
///ts:ref=Module
/// <reference path="../Module.ts"/> ///ts:ref:generated

module be.vmm.eenvplus.editor.featureLayers {
    'use strict';

    export var NAME:string = PREFIX + 'FeatureLayers';

    function configure():ng.IDirective {
        return {
            restrict: 'A',
            controller: FeatureLayersController
        };
    }

    FeatureLayersController.$inject = ['$scope', 'gaFeatureManager', 'gaFeatureLayerFactory'];

    export function FeatureLayersController(scope:ApplicationScope,
                                            features:feature.FeatureService,
                                            featureLayer:feature.FeatureLayerFactory) {

        /* ------------------ */
        /* --- properties --- */
        /* ------------------ */

        var map:ol.Map = scope.map,
            addLayer = map.addLayer.bind(map),
            removeLayer = map.removeLayer.bind(map),
            featureLayers:ol.layer.Layer[],
            unRegisterModeChange:Function;


        /* -------------------- */
        /* --- construction --- */
        /* -------------------- */

        scope.$on(mask.EVENT.selected, init);

        function init(event:ng.IAngularEvent, extent:ol.Extent):void {
            features.clear().then(_.partial(load, extent));
            unRegisterModeChange = scope.$on(applicationState.EVENT.modeChange, handleModeChange);
        }


        /* ----------------- */
        /* --- behaviour --- */
        /* ----------------- */

        function load(extent:ol.Extent):void {
            features.pull(extent)
                .then(createLayers)
                .catch((error:Error) => {
                    console.error('Failed to load features', error);
                });
        }

        function createLayers():void {
            featureLayers = [
                featureLayer.createLayer('be.vmm.eenvplus.sdi.model.KoppelPunt'),
                featureLayer.createLayer('be.vmm.eenvplus.sdi.model.RioolLink'),
                featureLayer.createLayer('be.vmm.eenvplus.sdi.model.RioolAppurtenance')
            ];
            featureLayers.forEach(addLayer);
        }

        function clear():void {
            unRegisterModeChange();
            featureLayers.forEach(removeLayer);
            featureLayers = [];
        }


        /* ---------------------- */
        /* --- event handlers --- */
        /* ---------------------- */

        function handleModeChange(event:ng.IAngularEvent, editMode:applicationState.State):void {
            if (editMode === applicationState.State.VIEW) clear();
        }

    }

    angular
        .module(MODULE)
        .directive(NAME, configure);

}
