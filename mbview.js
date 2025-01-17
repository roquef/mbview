const express = require('express');
const app = express();
const MBTiles = require('@mapbox/mbtiles');
const q = require('d3-queue').queue();
const utils = require('./utils');
const objectAssign = require('object-assign');
const cors = require('cors');
const compression = require('compression');
const apicache = require('apicache');
const cache = apicache.middleware
app.use(cors());
app.use(express.static('public'));
app.use(compression({ filter: shouldCompress }));

function shouldCompress(req, res) {
	if (req.headers['x-no-compression']) {
		return false
	}
	return compression.filter(req, res)
}

function onTile(req, res) {
	const p = req.params;
	const tiles = global.config.sources[p.source].tiles;

	tiles.getTile(p.z, p.x, p.y, (err, tile, headers) => {
		if (err) {
			res.status(204).send({ error: err });
		} else {
			res.writeHead(200, headers);
			res.end(tile);
		}
	});
}

module.exports = {
	/**
	 * Load a tileset and return a reference with metadata
	 * @param {object} file reference to the tileset
	 * @param {function} callback that returns the resulting tileset object
	 */
	loadTiles: function (file, callback) {
		new MBTiles(file, ((err, tiles) => {
			if (err) throw err;
			tiles.getInfo((err, info) => {
				if (err) throw err;

				const tileset = objectAssign({}, info, {
					tiles: tiles
				});

				callback(null, tileset);
			});
		}));
	},

	/**
	* Defer loading of multiple MBTiles and spin up server.
	* Will merge all the configurations found in the sources.
	* @param {object} config for the server, e.g. port
	* @param {function} callback with the server configuration loaded
	*/
	serve: function (config, callback) {
		const loadTiles = this.loadTiles;
		const listen = this.listen;

		config.mbtiles.forEach((file) => {
			q.defer(loadTiles, file);
		});

		q.awaitAll((error, tilesets) => {
			if (error) throw error;
			const finalConfig = utils.mergeConfigurations(config, tilesets);
			listen(finalConfig, callback);
		});
	},

	listen: function (config, onListen) {
		global.config = config;
		app.get('/:source/:z/:x/:y.pbf', cache('5 minutes'), onTile);
		app.get('/:source/:z/:x/:y.png', cache('5 minutes'), onTile);

		config.server = app.listen(config.port, () => {
			onListen(null, config);
		});
	}
};
