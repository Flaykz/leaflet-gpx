/**
 * Copyright (C) 2011-2012 Pavel Shramov
 * Copyright (C) 2013-2017 Maxime Petazzoni <maxime.petazzoni@bulix.org>
 * All Rights Reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * - Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * - Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

/*
 * Thanks to Pavel Shramov who provided the initial implementation and Leaflet
 * integration. Original code was at https://github.com/shramov/leaflet-plugins.
 *
 * It was then cleaned-up and modified to record and make available more
 * information about the GPX track while it is being parsed so that the result
 * can be used to display additional information about the track that is
 * rendered on the Leaflet map.
 */

var L = L || require('leaflet');

var _MAX_POINT_INTERVAL_MS = 15000;
var _SECOND_IN_MILLIS = 1000;
var _MINUTE_IN_MILLIS = 60 * _SECOND_IN_MILLIS;
var _HOUR_IN_MILLIS = 60 * _MINUTE_IN_MILLIS;
var _DAY_IN_MILLIS = 24 * _HOUR_IN_MILLIS;

var _GPX_STYLE_NS = 'http://www.topografix.com/GPX/gpx_style/0/2';

var _DEFAULT_MARKER_OPTS = {
  startIconUrl: 'pin-icon-start.png',
  endIconUrl: 'pin-icon-end.png',
  shadowUrl: 'pin-shadow.png',
  wptIcons: [],
  wptIconUrls : {
    '': 'pin-icon-wpt.png',
  },
  pointMatchers: [],
  iconSize: [33, 50],
  shadowSize: [50, 50],
  iconAnchor: [16, 45],
  shadowAnchor: [16, 47],
  clickable: false
};
var _DEFAULT_POLYLINE_OPTS = {
  color: 'blue'
};
var _DEFAULT_GPX_OPTS = {
  parseElements: ['track', 'route', 'waypoint'],
  showDistance: {
    enabled: false,
    imperial: false,
    iconColor: 'blue',
    textColor: 'white',
    interval: 1,
    radius: 10
  },
  showColor: {
    enabled: true,
    imperial: false,
    data: 'alt',
    thresholds: []
  }
};
L.GPX = L.FeatureGroup.extend({
  initialize: function(gpx, options) {
    options.max_point_interval = options.max_point_interval || _MAX_POINT_INTERVAL_MS;
    options.marker_options = this._merge_objs(
      _DEFAULT_MARKER_OPTS,
      options.marker_options || {});
    options.polyline_options = options.polyline_options || {};
    options.gpx_options = this._merge_objs(
      _DEFAULT_GPX_OPTS,
      options.gpx_options || {});

    L.Util.setOptions(this, options);

    // Base icon class for track pins.
    L.GPXTrackIcon = L.Icon.extend({ options: options.marker_options });

    this._gpx = gpx;
    this._layers = {};
    this._init_info();

    if (gpx) {
      this._parse(gpx, options, this.options.async);
    }
  },

  get_duration_string: function(duration, hidems) {
    var s = '';

    if (duration >= _DAY_IN_MILLIS) {
      s += Math.floor(duration / _DAY_IN_MILLIS) + 'd ';
      duration = duration % _DAY_IN_MILLIS;
    }

    if (duration >= _HOUR_IN_MILLIS) {
      s += Math.floor(duration / _HOUR_IN_MILLIS) + ':';
      duration = duration % _HOUR_IN_MILLIS;
    }

    var mins = Math.floor(duration / _MINUTE_IN_MILLIS);
    duration = duration % _MINUTE_IN_MILLIS;
    if (mins < 10) s += '0';
    s += mins + '\'';

    var secs = Math.floor(duration / _SECOND_IN_MILLIS);
    duration = duration % _SECOND_IN_MILLIS;
    if (secs < 10) s += '0';
    s += secs;

    if (!hidems && duration > 0) s += '.' + Math.round(Math.floor(duration)*1000)/1000;
    else s += '"';

    return s;
  },

  get_duration_string_iso: function(duration, hidems) {
    var s = this.get_duration_string(duration, hidems);
    return s.replace("'",':').replace('"','');
  },

  // Public methods
  to_miles:            function(v) { return v / 1.60934; },
  to_ft:               function(v) { return v * 3.28084; },
  m_to_km:             function(v) { return v / 1000; },
  m_to_mi:             function(v) { return v / 1609.34; },

  get_name:            function() { return this._info.name; },
  get_desc:            function() { return this._info.desc; },
  get_author:          function() { return this._info.author; },
  get_copyright:       function() { return this._info.copyright; },
  get_distance:        function() { return this._info.length; },
  get_distance_imp:    function() { return this.to_miles(this.m_to_km(this.get_distance())); },

  get_start_time:      function() { return this._info.duration.start; },
  get_end_time:        function() { return this._info.duration.end; },
  get_moving_time:     function() { return this._info.duration.moving; },
  get_total_time:      function() { return this._info.duration.total; },

  get_moving_pace:     function() { return this.get_moving_time() / this.m_to_km(this.get_distance()); },
  get_moving_pace_imp: function() { return this.get_moving_time() / this.get_distance_imp(); },

  get_moving_speed:    function() { return this.m_to_km(this.get_distance()) / (this.get_moving_time() / (3600 * 1000)) ; },
  get_moving_speed_imp:function() { return this.to_miles(this.m_to_km(this.get_distance())) / (this.get_moving_time() / (3600 * 1000)) ; },

  get_total_speed:     function() { return this.m_to_km(this.get_distance()) / (this.get_total_time() / (3600 * 1000)); },
  get_total_speed_imp: function() { return this.to_miles(this.m_to_km(this.get_distance())) / (this.get_total_time() / (3600 * 1000)); },

  get_elevation_gain:     function() { return this._info.elevation.gain; },
  get_elevation_loss:     function() { return this._info.elevation.loss; },
  get_elevation_gain_imp: function() { return this.to_ft(this.get_elevation_gain()); },
  get_elevation_loss_imp: function() { return this.to_ft(this.get_elevation_loss()); },
  get_elevation_data:     function() {
    var _this = this;
    return this._info.elevation._points.map(
      function(p) { return _this._prepare_data_point(p, _this.m_to_km, null,
        function(a, b) { return a.toFixed(2) + ' km, ' + b.toFixed(0) + ' m'; });
      });
  },
  get_elevation_data_imp: function() {
    var _this = this;
    return this._info.elevation._points.map(
      function(p) { return _this._prepare_data_point(p, _this.m_to_mi, _this.to_ft,
        function(a, b) { return a.toFixed(2) + ' mi, ' + b.toFixed(0) + ' ft'; });
      });
  },
  get_elevation_max:      function() { return this._info.elevation.max; },
  get_elevation_min:      function() { return this._info.elevation.min; },
  get_elevation_max_imp:  function() { return this.to_ft(this.get_elevation_max()); },
  get_elevation_min_imp:  function() { return this.to_ft(this.get_elevation_min()); },

  get_average_hr:         function() { return this._info.hr.avg; },
  get_average_temp:         function() { return this._info.atemp.avg; },
  get_average_cadence:         function() { return this._info.cad.avg; },
  get_heartrate_data:     function() {
    var _this = this;
    return this._info.hr._points.map(
      function(p) { return _this._prepare_data_point(p, _this.m_to_km, null,
        function(a, b) { return a.toFixed(2) + ' km, ' + b.toFixed(0) + ' bpm'; });
      });
  },
  get_heartrate_data_imp: function() {
    var _this = this;
    return this._info.hr._points.map(
      function(p) { return _this._prepare_data_point(p, _this.m_to_mi, null,
        function(a, b) { return a.toFixed(2) + ' mi, ' + b.toFixed(0) + ' bpm'; });
      });
  },
  get_cadence_data:     function() {
    var _this = this;
    return this._info.cad._points.map(
      function(p) { return _this._prepare_data_point(p, _this.m_to_km, null,
        function(a, b) { return a.toFixed(2) + ' km, ' + b.toFixed(0) + ' rpm'; });
      });
  },
  get_temp_data:     function() {
    var _this = this;
    return this._info.atemp._points.map(
      function(p) { return _this._prepare_data_point(p, _this.m_to_km, null,
        function(a, b) { return a.toFixed(2) + ' km, ' + b.toFixed(0) + ' degrees'; });
      });
  },
  get_cadence_data_imp:     function() {
    var _this = this;
    return this._info.cad._points.map(
      function(p) { return _this._prepare_data_point(p, _this.m_to_mi, null,
        function(a, b) { return a.toFixed(2) + ' mi, ' + b.toFixed(0) + ' rpm'; });
      });
  },
  get_temp_data_imp:     function() {
    var _this = this;
    return this._info.atemp._points.map(
      function(p) { return _this._prepare_data_point(p, _this.m_to_mi, null,
        function(a, b) { return a.toFixed(2) + ' mi, ' + b.toFixed(0) + ' degrees'; });
      });
  },

  reload: function() {
    this._init_info();
    this.clearLayers();
    this._parse(this._gpx, this.options, this.options.async);
  },

  // Private methods
  _merge_objs: function(a, b) {
    var _ = {};
    for (var attr in a) { _[attr] = a[attr]; }
    for (var attr in b) { _[attr] = b[attr]; }
    return _;
  },

  _prepare_data_point: function(p, trans1, trans2, trans_tooltip) {
    var r = [trans1 && trans1(p[0]) || p[0], trans2 && trans2(p[1]) || p[1]];
    r.push(trans_tooltip && trans_tooltip(r[0], r[1]) || (r[0] + ': ' + r[1]));
    return r;
  },

  _init_info: function() {
    this._info = {
      name: null,
      length: 0.0,
      elevation: {gain: 0.0, loss: 0.0, max: 0.0, min: Infinity, _points: []},
      hr: {avg: 0, _total: 0, _points: []},
      duration: {start: null, end: null, moving: 0, total: 0},
      atemp: {avg: 0, _total: 0, _points: []},
      cad: {avg: 0, _total: 0, _points: []}
    };
  },

  _load_xml: function(url, cb, options, async) {
    if (async == undefined) async = this.options.async;
    if (options == undefined) options = this.options;

    var req = new window.XMLHttpRequest();
    req.open('GET', url, async);
    try {
      req.overrideMimeType('text/xml'); // unsupported by IE
    } catch(e) {}
    req.onreadystatechange = function() {
      if (req.readyState != 4) return;
      if(req.status == 200) cb(req.responseXML, options);
    };
    req.send(null);
  },

  _parse: function(input, options, async) {
    var _this = this;
    var cb = function(gpx, options) {
      var layers = _this._parse_gpx_data(gpx, options);
      if (!layers) return;
      _this.addLayer(layers);
      _this.fire('loaded', { layers: layers, element: gpx });
    }
    if (input.substr(0,1)==='<') { // direct XML has to start with a <
      var parser = new DOMParser();
      if (async) {
        setTimeout(function() {
          cb(parser.parseFromString(input, "text/xml"), options);
        });
      } else {
        cb(parser.parseFromString(input, "text/xml"), options);
      }
    } else {
      this._load_xml(input, cb, options, async);
    }
  },

  _parse_gpx_data: function(xml, options) {
    var i, t, l, el, layers = [];
    var tags = [];

    var parseElements = options.gpx_options.parseElements;
    if (parseElements.indexOf('route') > -1) {
      tags.push(['rte','rtept']);
    }
    if (parseElements.indexOf('track') > -1) {
      tags.push(['trkseg','trkpt']);
    }

    var name = xml.getElementsByTagName('name');
    if (name.length > 0) {
      this._info.name = name[0].textContent;
    }
    var desc = xml.getElementsByTagName('desc');
    if (desc.length > 0) {
      this._info.desc = desc[0].textContent;
    }
    var author = xml.getElementsByTagName('author');
    if (author.length > 0) {
      this._info.author = author[0].textContent;
    }
    var copyright = xml.getElementsByTagName('copyright');
    if (copyright.length > 0) {
      this._info.copyright = copyright[0].textContent;
    }

    for (t = 0; t < tags.length; t++) {
      el = xml.getElementsByTagName(tags[t][0]);
      for (i = 0; i < el.length; i++) {
        var trackLayers = this._parse_trkseg(el[i], options, tags[t][1]);
        for (l = 0; l < trackLayers.length; l++) {
          layers.push(trackLayers[l]);
        }
      }
    }

    this._info.hr.avg = Math.round(this._info.hr._total / this._info.hr._points.length);
    this._info.cad.avg = Math.round(this._info.cad._total / this._info.cad._points.length);
    this._info.atemp.avg = Math.round(this._info.atemp._total / this._info.atemp._points.length);

    // parse waypoints and add markers for each of them
    if (parseElements.indexOf('waypoint') > -1) {
      el = xml.getElementsByTagName('wpt');
      for (i = 0; i < el.length; i++) {
        var ll = new L.LatLng(
            el[i].getAttribute('lat'),
            el[i].getAttribute('lon'));

        var nameEl = el[i].getElementsByTagName('name');
        var name = '';
        if (nameEl.length > 0) {
          name = nameEl[0].textContent;
        }

        var descEl = el[i].getElementsByTagName('desc');
        var desc = '';
        if (descEl.length > 0) {
          desc = descEl[0].textContent;
        }

        var symEl = el[i].getElementsByTagName('sym');
        var symKey = '';
        if (symEl.length > 0) {
          symKey = symEl[0].textContent;
        }

        /*
         * Add waypoint marker based on the waypoint symbol key.
         *
         * First look for a configured icon for that symKey. If not found, look
         * for a configured icon URL for that symKey and build an icon from it.
         * Otherwise, fall back to the default icon if one was configured, or
         * finally to the default icon URL.
         */
        var wptIcons = options.marker_options.wptIcons;
        var wptIconUrls = options.marker_options.wptIconUrls;
        var symIcon;
        if (wptIcons && wptIcons[symKey]) {
          symIcon = wptIcons[symKey];
        } else if (wptIconUrls && wptIconUrls[symKey]) {
          symIcon = new L.GPXTrackIcon({iconUrl: wptIconUrls[symKey]});
        } else if (wptIcons && wptIcons['']) {
          symIcon = wptIcons[''];
        } else if (wptIconUrls && wptIconUrls['']) {
          symIcon = new L.GPXTrackIcon({iconUrl: wptIconUrls['']});
        } else {
          console.log('No icon or icon URL configured for symbol type "' + symKey
            + '", and no fallback configured; ignoring waypoint.');
          continue;
        }

        var marker = new L.Marker(ll, {
          clickable: options.marker_options.clickable,
          title: name,
          icon: symIcon
        });
        marker.bindPopup("<b>" + name + "</b>" + (desc.length > 0 ? '<br>' + desc : '')).openPopup();
        this.fire('addpoint', { point: marker, point_type: 'waypoint', element: el[i] });
        layers.push(marker);
      }
    }

    if (layers.length > 1) {
       return new L.FeatureGroup(layers);
    } else if (layers.length == 1) {
      return layers[0];
    }
  },

  _parse_trkseg: function(line, options, tag) {
    var el = line.getElementsByTagName(tag);
    var distance_layer = [];
    var _this = this;
    if (!el.length) return [];

    var coords = [];
    var markers = [];
    var layers = [];
    var last = null;
    
    if (options.gpx_options.showDistance.enabled) {
      var distance_iterator = 1;
      var distanceMarkers = new L.featureGroup();
      var element = document.createElement('style');
      document.head.appendChild(element);
      var sheet = element.sheet;
      var styles = '';
      styles += '.distance_tooltip {';
      styles += 'background: none!important;';
      styles += 'border: none!important;';
      styles += 'font-weight: 900!important;';
      styles += 'font-size: larger!important;';
      styles += 'box-shadow: none!important;';
      styles += 'color: ' + options.gpx_options.showDistance.textColor + ';';
      styles += '}';
      sheet.insertRule(styles, 0);
    }
    
    

    for (var i = 0; i < el.length; i++) {
      var _, ll = new L.LatLng(
        el[i].getAttribute('lat'),
        el[i].getAttribute('lon'));
      ll.meta = { time: null, ele: null, hr: null, cad: null, atemp: null };

      _ = el[i].getElementsByTagName('time');
      if (_.length > 0) {
        ll.meta.time = new Date(Date.parse(_[0].textContent));
      } else {
        ll.meta.time = new Date('1970-01-01T00:00:00');
      }

      _ = el[i].getElementsByTagName('ele');
      if (_.length > 0) {
        ll.meta.ele = parseFloat(_[0].textContent);
      }

      _ = el[i].getElementsByTagName('name');
      if (_.length > 0) {
        var name = _[0].textContent;
        var ptMatchers = options.marker_options.pointMatchers || [];

        for (var j = 0; j < ptMatchers.length; j++) {
          if (ptMatchers[j].regex.test(name)) {
            markers.push({ label: name, coords: ll, icon: ptMatchers[j].icon, element: el[i] });
            break;
          }
        }
      }

      _ = el[i].getElementsByTagNameNS('*', 'hr');
      if (_.length > 0) {
        ll.meta.hr = parseInt(_[0].textContent);
        this._info.hr._points.push([this._info.length, ll.meta.hr]);
        this._info.hr._total += ll.meta.hr;
      }

      _ = el[i].getElementsByTagNameNS('*', 'cad');
      if (_.length > 0) {
        ll.meta.cad = parseInt(_[0].textContent);
        this._info.cad._points.push([this._info.length, ll.meta.cad]);
        this._info.cad._total += ll.meta.cad;
      }

      _ = el[i].getElementsByTagNameNS('*', 'atemp');
      if (_.length > 0) {
        ll.meta.atemp = parseInt(_[0].textContent);
        this._info.atemp._points.push([this._info.length, ll.meta.atemp]);
        this._info.atemp._total += ll.meta.atemp;
      }

      if (ll.meta.ele > this._info.elevation.max) {
        this._info.elevation.max = ll.meta.ele;
      }

      if (ll.meta.ele < this._info.elevation.min) {
        this._info.elevation.min = ll.meta.ele;
      }

      this._info.elevation._points.push([this._info.length, ll.meta.ele]);
      this._info.duration.end = ll.meta.time;

      if (last != null) {
        this._info.length += this._dist3d(last, ll);
        ll.meta.dist = this._info.length;
        if (options.gpx_options.showDistance.enabled) {
          this.currentDistance = this.m_to_km(this._info.length);
          if (options.gpx_options.showDistance.imperial) {
            this.currentDistance = this.to_miles(this.currentDistance);
          }
          let next_distance = options.gpx_options.showDistance.interval * distance_iterator;
          if (this.currentDistance > next_distance) {
            distance_iterator += 1;
            var marker = new L.circleMarker(ll, {
              radius: options.gpx_options.showDistance.radius,
              stroke: false,
              fillColor: options.gpx_options.showDistance.iconColor,
              fillOpacity: 1
            }).bindTooltip(next_distance.toString(), {
              direction: 'center',
              permanent: true,
              interactive: true,
              className: 'distance_tooltip'
            });
            distance_layer.push(marker);
            marker.addTo(distanceMarkers);
          } 
        }

        var t = ll.meta.ele - last.meta.ele;
        if (t > 0) {
          this._info.elevation.gain += t;
        } else {
          this._info.elevation.loss += Math.abs(t);
        }

        t = Math.abs(ll.meta.time - last.meta.time);
        this._info.duration.total += t;
        if (t < options.max_point_interval) {
          this._info.duration.moving += t;
        }
      } else if (this._info.duration.start == null) {
        this._info.duration.start = ll.meta.time;
      }

      last = ll;
      coords.push(ll);
    }
    
    var chartObj = {};
    chartObj.ele = [];
    chartObj.hr = [];
    for (var i = 0, lenCoords = coords.length;i < lenCoords; i++) {
      chartObj.ele.push({x: i, y: coords[i].meta.ele});
      chartObj.hr.push({x: i, y: coords[i].meta.hr})
    }
    
    var chart_1 = document.createElement("div");
    chart_1.classList.add("chart");
    chart_1.id = "chart_1";
    chart_1.style.height = "50%";
    document.getElementById("chart_zone").appendChild(chart_1);
    var chartOptions = {
      theme: "light1", // "light2", "dark1", "dark2"
    	zoomEnabled: true,
    	animationEnabled: true,
    	title:{
    		text: "altitude"
    	},
    	axisY: {
    		includeZero: false,
    		lineThickness: 1
    	},
    	axisX: {
    		includeZero: true,
    		lineThickness: 1
    	},
    	data: [
      	{
      		type: "area",
      		dataPoints: chartObj.ele
      	}
    	]
    };
    var chart = new CanvasJS.Chart("chart_1", chartOptions);
    chart.render();
    
    var chart_2 = document.createElement("div");
    chart_2.classList.add("chart");
    chart_2.id = "chart_2";
    chart_2.style.height = "50%";
    document.getElementById("chart_zone").appendChild(chart_2);
    var chartOptions = {
      theme: "light1", // "light2", "dark1", "dark2"
    	zoomEnabled: true,
    	animationEnabled: true,
    	title:{
    		text: "Heart Rate"
    	},
    	axisY: {
    		includeZero: false,
    		lineThickness: 1
    	},
    	axisX: {
    		includeZero: true,
    		lineThickness: 1
    	},
    	data: [
      	{
      		type: "area",
      		dataPoints: chartObj.hr
      	}
    	]
    };
    var chart = new CanvasJS.Chart("chart_2", chartOptions);
    chart.render();
    
    if (options.gpx_options.showDistance.enabled) {
      if (distance_layer.length > 1) {
        distanceMarkers.addTo(this);
      }
    }
    
    // check for gpx_style styling extension
    var polyline_options = this._merge_objs(_DEFAULT_POLYLINE_OPTS, {});
    var e = line.getElementsByTagNameNS(_GPX_STYLE_NS, 'line');
    if (e.length > 0) {
      var _ = e[0].getElementsByTagName('color');
      if (_.length > 0) polyline_options.color = '#' + _[0].textContent;
      var _ = e[0].getElementsByTagName('opacity');
      if (_.length > 0) polyline_options.opacity = _[0].textContent;
      var _ = e[0].getElementsByTagName('weight');
      if (_.length > 0) polyline_options.weight = _[0].textContent;
      var _ = e[0].getElementsByTagName('linecap');
      if (_.length > 0) polyline_options.lineCap = _[0].textContent;
    }

    // add track
    if (options.gpx_options.showColor.enabled) {
      if (options.gpx_options.showColor.thresholds.length > 0) {
        //
      } else {
        var ele_max = this.get_elevation_max();
        var ele_min = this.get_elevation_min();
        if (options.gpx_options.showDistance.imperial) {
          ele_max = this.get_elevation_max_imp();
          ele_min = this.get_elevation_min_imp();
        }
        var diff = ele_max - ele_min;
        var sep = diff / 9;
        var valueThresholds = [];
        for (let i = 1; i <= 9; i++) {
          valueThresholds.push(ele_min + (sep * i));
        }
        var colorThresholds = ['#0000FF', '#0040FF', '#0080FF', '#00FFB0',
          '#00E000', '#80FF00', '#FFFF00', '#FFC000', '#FF0000'];
      }
      var tbody = document.createElement("tbody");
      for (let i = 0, len = valueThresholds.length; i < len; i++) {
        var tr = document.createElement("tr");
        var td1 = document.createElement("td");
        var td2 = document.createElement("td");
        td1.setAttribute("width", "25px");
        td1.setAttribute("bgcolor", colorThresholds[i]);
        let threshMin = valueThresholds[i] - sep;
        td2.appendChild(document.createTextNode(" " + threshMin.toFixed(0) + " - " + valueThresholds[i].toFixed(0)));
        tr.appendChild(td1);
        tr.appendChild(td2);
        tbody.appendChild(tr);
      }
      var divTab = document.createElement("div");
      divTab.id = "color_table"
      divTab.appendChild(tbody);
      document.getElementById("sidebar").appendChild(divTab);
      var coordsPolyline = {};
      var lastColor = null;
      var segment = 0;
      for (let j = 0, lenCoords = coords.length; j < lenCoords; j++) {
        for (let i = 0, lenValue = valueThresholds.length; i < lenValue; i++) {
          if ((coords[j].meta.ele <= valueThresholds[i]) && (valueThresholds[i] - coords[j].meta.ele <= sep)) {
            if (lastColor != i) {
              if (coordsPolyline[segment] == undefined) {
                coordsPolyline[segment] = [coords[j]];
              } else {
                coordsPolyline[segment].push(coords[j]);
              }
              segment += 1;
              if (coordsPolyline.color == undefined) {
                coordsPolyline.color = [colorThresholds[i]];
              } else {
                coordsPolyline.color.push(colorThresholds[i]);
              }
            }
            if (coordsPolyline[segment] == undefined) {
              coordsPolyline[segment] = [coords[j]];
            } else {
              coordsPolyline[segment].push(coords[j]);
            }
            lastColor = i;
          }
        }
      }
      for (let i = 1; i <= segment; i++) {
        var polyline_options_override = {
  				color: coordsPolyline.color[i-1],
  				opacity: 0.75,
  				weight: 3,
  				lineCap: 'round'
  			};
        var l = new L.Polyline(coordsPolyline[i], this._merge_objs(polyline_options, polyline_options_override));
        this.fire('addline', { line: l, element: line });
        layers.push(l);
      }
    } else {
      var l = new L.Polyline(coords, this._merge_objs(polyline_options, options.polyline_options));
      this.fire('addline', { line: l, element: line });
      layers.push(l);
    }

    if (options.marker_options.startIcon || options.marker_options.startIconUrl) {
      // add start pin
      var marker = new L.Marker(coords[0], {
        clickable: options.marker_options.clickable,
        icon: options.marker_options.startIcon || new L.GPXTrackIcon({iconUrl: options.marker_options.startIconUrl})
      });
      this.fire('addpoint', { point: marker, point_type: 'start', element: el[0] });
      layers.push(marker);
    }

    if (options.marker_options.endIcon || options.marker_options.endIconUrl) {
      // add end pin
      var marker = new L.Marker(coords[coords.length-1], {
        clickable: options.marker_options.clickable,
        icon: options.marker_options.endIcon || new L.GPXTrackIcon({iconUrl: options.marker_options.endIconUrl})
      });
      this.fire('addpoint', { point: marker, point_type: 'end', element: el[el.length-1] });
      layers.push(marker);
    }

    // add named markers
    for (var i = 0; i < markers.length; i++) {
      var marker = new L.Marker(markers[i].coords, {
        clickable: options.marker_options.clickable,
        title: markers[i].label,
        icon: markers[i].icon
      });
      this.fire('addpoint', { point: marker, point_type: 'label', element: markers[i].element });
      layers.push(marker);
    }

    return layers;
  },

  _dist2d: function(a, b) {
    var R = 6371000;
    var dLat = this._deg2rad(b.lat - a.lat);
    var dLon = this._deg2rad(b.lng - a.lng);
    var r = Math.sin(dLat/2) *
      Math.sin(dLat/2) +
      Math.cos(this._deg2rad(a.lat)) *
      Math.cos(this._deg2rad(b.lat)) *
      Math.sin(dLon/2) *
      Math.sin(dLon/2);
    var c = 2 * Math.atan2(Math.sqrt(r), Math.sqrt(1-r));
    var d = R * c;
    return d;
  },

  _dist3d: function(a, b) {
    var planar = this._dist2d(a, b);
    var height = Math.abs(b.meta.ele - a.meta.ele);
    return Math.sqrt(Math.pow(planar, 2) + Math.pow(height, 2));
  },

  _deg2rad: function(deg) {
    return deg * Math.PI / 180;
  }
});

if (typeof module === 'object' && typeof module.exports === 'object') {
  module.exports = L;
} else if (typeof define === 'function' && define.amd) {
  define(L);
}
