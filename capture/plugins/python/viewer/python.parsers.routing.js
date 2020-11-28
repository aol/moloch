const flatten = require('array-flatten')

function registerRoute(app, path)
{
    newRoute = app.route(path);

    route = function(path) {
        return (layer) => layer.route && flatten([layer.route.path]).indexOf(path) != -1
    }

    var routerStack = app._router.stack;

    var rootIdx = routerStack.findIndex(route('/'));
    var routeIdx = routerStack.findIndex(route(path));

    var routeLayer = routerStack.splice(routeIdx,1)[0];
    routerStack.splice(rootIdx+1,0,routeLayer)

    return newRoute;
}


exports.registerRoute = registerRoute

// exports.init = function (Config, emitter, api) {
//     var app = api.getApp();
//     var route = registerRoute(app, '/python/parsers/:parser/decode')
//     route.get(function(req, res) {
//         res.send({"key":req.params.parser});
//     })
// }

