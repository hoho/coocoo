CooCoo.View = {};

CooCoo.ViewBase = CooCoo.Base.extend({
    init: function(render/*, parent, ...*/) {
        var args = Array.prototype.slice.call(arguments, 1);

        CooCoo.ViewBase.__super__.init.apply(this, args);

        if (render) {
            args.shift();
            return this._render.apply(this, args);
        }
    },

    _render: function() {
        var self = this,
            elems = self.__elems = [],
            ret = self.__render.apply(self, arguments),
            elem = ret.valueOf();

        /* jshint browser: true */
        if (elem instanceof Node) {
            if (elem.nodeType === 11) {
                // It's a document fragment.
                elem = elem.firstChild;
                while (elem) {
                    elems.push(elem);
                    elem = elem.nextSibling;
                }
            } else {
                elems.push(elem);
            }
        }
        /* jshint browser: false */

        return ret;
    },

    __render: function() {},

    destroy: function() {
        var self = this,
            i,
            elems = self.__elems,
            elem;

        // TODO: Check if parent view is destroyed, to avoid removeChild from
        //       removed nodes.
        if (elems) {
            for (i = 0; i < elems.length; i++) {
                elem = elems[i];
                if (elem.parentNode) {
                    elem.parentNode.removeChild(elem);
                }
            }
        }

        /* jshint -W106 */
        CooCoo.ViewBase.__super__.destroy.call(self);
        /* jshint +W106 */
    }
});
