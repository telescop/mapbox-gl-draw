const CommonSelectors = require('../lib/common_selectors');
const LineString = require('../feature_types/line_string');
const isEventAtCoordinates = require('../lib/is_event_at_coordinates');
const doubleClickZoom = require('../lib/double_click_zoom');
const Constants = require('../constants');
const createVertex = require('../lib/create_vertex');

module.exports = function(ctx, opts) {
  opts = opts || {};
  const featureId = opts.featureId;

  let line, currentVertexPosition;
  let direction = 'forward';
  if (featureId) {
    line = ctx.store.get(featureId);
    if (!line) {
      throw new Error('Could not find a feature with the provided featureId');
    }
    let from = opts.from;
    if (from && from.type === 'Feature' && from.geometry && from.geometry.type === 'Point') {
      from = from.geometry;
    }
    if (from && from.type === 'Point' && from.coordinates && from.coordinates.length === 2) {
      from = from.coordinates;
    }
    if (!from || !Array.isArray(from)) {
      throw new Error('Please use the `from` property to indicate which point to continue the line from');
    }
    const lastCoord = line.coordinates.length - 1;
    if (line.coordinates[lastCoord][0] === from[0] && line.coordinates[lastCoord][1] === from[1]) {
      currentVertexPosition = lastCoord + 1;
      // add one new coordinate to continue from
      line.addCoordinate(currentVertexPosition, ...line.coordinates[lastCoord]);
    } else if (line.coordinates[0][0] === from[0] && line.coordinates[0][1] === from[1]) {
      direction = 'backwards';
      currentVertexPosition = 0;
      // add one new coordinate to continue from
      line.addCoordinate(currentVertexPosition, ...line.coordinates[0]);
    } else {
      throw new Error('`from` should match the point at either the start or the end of the provided LineString');
    }
  } else {
    line = new LineString(ctx, {
      type: Constants.geojsonTypes.FEATURE,
      properties: {},
      geometry: {
        type: Constants.geojsonTypes.LINE_STRING,
        coordinates: []
      }
    });
    currentVertexPosition = 0;
    ctx.store.add(line);
  }

  if (ctx._test) ctx._test.line = line;

  return {
    start: function() {
      ctx.store.clearSelected();
      doubleClickZoom.disable(ctx);
      ctx.ui.queueMapClasses({ mouse: Constants.cursors.ADD });
      ctx.ui.setActiveButton(Constants.types.LINE);

      this.on('mousemove', CommonSelectors.true, (e) => {
        line.updateCoordinate(currentVertexPosition, e.lngLat.lng, e.lngLat.lat);
        if (CommonSelectors.isVertex(e)) {
          ctx.ui.queueMapClasses({ mouse: Constants.cursors.POINTER });
        }
      });

      this.on('click', CommonSelectors.true, clickAnywhere);
      this.on('tap', CommonSelectors.true, clickAnywhere);
      this.on('click', CommonSelectors.isVertex, clickOnVertex);
      this.on('tap', CommonSelectors.isVertex, clickOnVertex);

      function clickAnywhere(e) {
        if (currentVertexPosition > 0 && isEventAtCoordinates(e, line.coordinates[currentVertexPosition - 1]) ||
            direction === 'backwards' && isEventAtCoordinates(e, line.coordinates[currentVertexPosition + 1])) {
          return ctx.events.changeMode(Constants.modes.SIMPLE_SELECT, { featureIds: [line.id] });
        }
        ctx.ui.queueMapClasses({ mouse: Constants.cursors.ADD });
        line.updateCoordinate(currentVertexPosition, e.lngLat.lng, e.lngLat.lat);
        if (direction === 'forward') {
          currentVertexPosition++;
          line.updateCoordinate(currentVertexPosition, e.lngLat.lng, e.lngLat.lat);
        } else {
          line.addCoordinate(0, e.lngLat.lng, e.lngLat.lat);
        }
      }

      function clickOnVertex() {
        return ctx.events.changeMode(Constants.modes.SIMPLE_SELECT, { featureIds: [line.id] });
      }

      this.on('keyup', CommonSelectors.isEscapeKey, () => {
        ctx.store.delete([line.id], { silent: true });
        ctx.events.changeMode(Constants.modes.SIMPLE_SELECT);
      });
      this.on('keyup', CommonSelectors.isEnterKey, () => {
        ctx.events.changeMode(Constants.modes.SIMPLE_SELECT, { featureIds: [line.id] });
      });
      ctx.events.actionable({
        combineFeatures: false,
        uncombineFeatures: false,
        trash: true
      });
    },

    stop() {
      doubleClickZoom.enable(ctx);
      ctx.ui.setActiveButton();

      // check to see if we've deleted this feature
      if (ctx.store.get(line.id) === undefined) return;

      //remove last added coordinate
      line.removeCoordinate(`${currentVertexPosition}`);
      if (line.isValid()) {
        ctx.map.fire(Constants.events.CREATE, {
          features: [line.toGeoJSON()]
        });
      } else {
        ctx.store.delete([line.id], { silent: true });
        ctx.events.changeMode(Constants.modes.SIMPLE_SELECT, {}, { silent: true });
      }
    },

    render(geojson, callback) {
      const isActiveLine = geojson.properties.id === line.id;
      geojson.properties.active = (isActiveLine) ? Constants.activeStates.ACTIVE : Constants.activeStates.INACTIVE;
      if (!isActiveLine) return callback(geojson);
      // Only render the line if it has at least one real coordinate
      if (geojson.geometry.coordinates.length < 2) return;
      geojson.properties.meta = Constants.meta.FEATURE;
      callback(createVertex(
        line.id,
        geojson.geometry.coordinates[direction === 'forward' ? geojson.geometry.coordinates.length - 2 : 1],
        `${direction === 'forward' ? geojson.geometry.coordinates.length - 2 : 1}`,
        false
      ));

      callback(geojson);
    },

    trash() {
      ctx.store.delete([line.id], { silent: true });
      ctx.events.changeMode(Constants.modes.SIMPLE_SELECT);
    }
  };
};
