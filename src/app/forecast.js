// -*- Mode: js; indent-tabs-mode: nil; c-basic-offset: 4; tab-width: 4 -*-
//
// Copyright (c) 2012 Giovanni Campagna <scampa.giovanni@gmail.com>
//
// Gnome Weather is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by the
// Free Software Foundation; either version 2 of the License, or (at your
// option) any later version.
//
// Gnome Weather is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
// or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
// for more details.
//
// You should have received a copy of the GNU General Public License along
// with Gnome Weather; if not, write to the Free Software Foundation,
// Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const GWeather = imports.gi.GWeather;
const Lang = imports.lang;

const Params = imports.misc.params;
const Strings = imports.shared.strings;
const Util = imports.misc.util;

// In microseconds
const ONE_DAY = 24*3600*1000*1000;
const TWELVE_HOURS = 12*3600*1000*1000;
const ONE_HOUR = 3600*1000*1000;

const ForecastBox = new Lang.Class({
    Name: 'ForecastBox',
    Extends: Gtk.Frame,

    _init: function(params) {
        params = Params.fill(params, { shadow_type: Gtk.ShadowType.NONE });
        this.parent(params);
        this.get_accessible().accessible_name = _("Forecast");

        this._grid = new Gtk.Grid({ orientation: Gtk.Orientation.HORIZONTAL,
                                    column_spacing: 24,
                                    row_spacing: 6,
                                    margin: 12,
                                    column_homogeneous: true });
        this.add(this._grid);

        let context = this.get_style_context();
        context.add_class('background');
        context.add_class('osd');
    },

    update: function(infos) {
        let dates = infos.map(function(i) {
            let [ok, date] = i.get_value_update();
            return GLib.DateTime.new_from_unix_local(date);
        });

        let subday = this._hasSubdayResolution(dates);
        this._today = GLib.DateTime.new_now_local();
        this._tomorrow = this._today.add_days(1);

        let current, currentPart;
        let n = 0;
        // limit to 5 infos max
        for (let i = 0; i < dates.length && n < 5; i++) {
            let info = infos[i];

            // only show forecasts if they're separated by
            // at least 12 hours
            let [ok, date] = info.get_value_update();
            let datetime = GLib.DateTime.new_from_unix_local(date);
            let part = Strings.getDatetimePart(datetime);

            // Filter out "uninteresting" times (ie, during the night)
            if (part == -1)
                continue;

            // Filter two datetime that would give the same "Day Part" string
            if (current && part == currentPart &&
                Util.arrayEqual(current.get_ymd(), datetime.get_ymd()))
                continue;

            let text = '<b>' + this._getDate(datetime, subday) + '</b>';
            let label = new Gtk.Label({ label: text,
                                        use_markup: true,
                                        visible: true });
            this._grid.attach(label, n, 0, 1, 1);

            let image = new Gtk.Image({ icon_name: info.get_symbolic_icon_name(),
                                        icon_size: Gtk.IconSize.DIALOG,
                                        use_fallback: true,
                                        visible: true });
            this._grid.attach(image, n, 1, 1, 1);

            let temperature = new Gtk.Label({ label: this._getTemperature(info),
                                              visible: true });
            this._grid.attach(temperature, n, 2, 1, 1);

            current = datetime;
            currentPart = part;
            n++;
        }
    },

    clear: function() {
        this._grid.foreach(function(w) { w.destroy(); });
    },

    _hasSubdayResolution: function(dates) {
        if (dates.length == 1)
            return false;

        if (dates[1].difference(dates[0]) < ONE_DAY)
            return true;
        else
            return false;
    },

    _getDate: function(datetime, subday) {
        if (Util.arrayEqual(this._today.get_ymd(),
                            datetime.get_ymd())) {
            if (subday)
                return Strings.formatToday(datetime);
            else
                return _("Today");
        } else if (Util.arrayEqual(this._tomorrow.get_ymd(),
                                   datetime.get_ymd())) {
            if (subday)
                return Strings.formatTomorrow(datetime);
            else
                return _("Tomorrow");
        } else {
            if (subday)
                return Strings.formatDayPart(datetime);
            else
                return datetime.format('%A');
        }
    },

    _getTemperature: function(info) {
        let [ok1, ] = info.get_value_temp_min(GWeather.TemperatureUnit.DEFAULT);
        let [ok2, ] = info.get_value_temp_max(GWeather.TemperatureUnit.DEFAULT);

        if (ok1 && ok2) {
            // TRANSLATORS: this is the temperature string, minimum and maximum.
            // The two values are already formatted, so it would be something like
            // "7 °C / 19 °C"
            return _("%s / %s").format(info.get_temp_min(), info.get_temp_max());
        } else {
            return info.get_temp_summary();
        }
    }
});

const TodaySidebar = new Lang.Class({
    Name: 'TodaySidebar',
    Extends: Gtk.ScrolledWindow,

    _init: function(params) {
        params = Params.fill(params, { hscrollbar_policy: Gtk.PolicyType.NEVER });
        this.parent(params);

        let context = this.get_style_context();
        context.add_class('view');
        context.add_class('content-view');

        this._settings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });

        let box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL,
                                vexpand: true });
        this.add(box);

        this._grid = new Gtk.Grid({ column_spacing: 12,
                                    row_spacing: 6,
                                    margin: 12 });
        box.add(this._grid);

        this._headline = new Gtk.Label({ use_markup: true,
                                         xalign: 0.0 });
        this._grid.attach(this._headline, 0, 0, 3, 1);

        this._subline = new Gtk.Label({ margin_bottom: 4,
                                        xalign: 0.0 });
        this._grid.attach(this._subline, 0, 1, 3, 1);

        this._attribution = new Gtk.Label({ xalign: 0.5,
                                            wrap: true,
                                            max_width_chars: 32,
                                            margin_bottom: 10,
                                            name: 'attribution-label',
                                            use_markup: true });
        box.pack_end(this._attribution, false, false, 0);

        this._moreButton = new Gtk.Button({ label: _("More…"),
                                            margin_top: 4,
                                            halign: Gtk.Align.END,
                                            visible: true });
        this._moreButton.connect('clicked', Lang.bind(this, this._changeView));
        this._tomorrow = false;

        this._infoWidgets = [];
        this._trimmedIndex = -1;
    },

    clear: function() {
        this._infoWidgets.forEach(function(w) { w.destroy(); });
        this._infoWidgets = [];

        if (this._moreButton.get_parent())
            this._grid.remove(this._moreButton);
    },

    // Ensure that infos are sufficiently spaced, and
    // remove infos for the wrong day
    _preprocess: function(now, infos) {
        let ret = [];
        let i;
        let current;

        // First ignore all infos that are on a different
        // day than now.
        // infos are ordered by time, and it's assumed at some point
        // there is an info for the current day (otherwise, nothing
        // is shown)
        for (i = 0; i < infos.length; i++) {
            let info = infos[i];

            let [ok, date] = info.get_value_update();
            let datetime = GLib.DateTime.new_from_unix_local(date);

            if (Util.arrayEqual(now.get_ymd(), datetime.get_ymd())) {
                current = datetime;
                break;
            }
        }

        for ( ; i < infos.length; i++) {
            let info = infos[i];

            let [ok, date] = info.get_value_update();
            let datetime = GLib.DateTime.new_from_unix_local(date);
            if (datetime.difference(current) < ONE_HOUR)
                continue;

            if (!Util.arrayEqual(now.get_ymd(),
                                 datetime.get_ymd()))
                break;

            ret.push(info);
            current = datetime;
        }

        return ret;
    },

    update: function(info) {
        let infos = info.get_forecast_list();

        let [ok, v_first] = infos[0].get_value_update();

        let now = GLib.DateTime.new_now_local();
        let first = GLib.DateTime.new_from_unix_local(v_first);

        this._trimmedToday = this._preprocess(now, infos);
        this._trimmedTomorrow = this._preprocess(now.add_days(1), infos);

        let hasToday = this._trimmedToday.length > 0;
        let hasTomorrow = this._trimmedTomorrow.length > 0;

        this._tomorrow = !hasToday;
        this._updateHeadline();

        let i;
        let infos = hasToday ? this._trimmedToday : this._trimmedTomorrow;

        // Show at most 6 hours now, we'll show more with the ... button
        for (i = 0; i < Math.min(infos.length, 6); i++) {
            let info = infos[i];
            this._addOneInfo(info, i + 2);
        }

        this._grid.attach(this._moreButton, 2, i+2, 1, 1);

        this._trimmedIndex = i;
        this._hasMore = false;
        if (this._trimmedIndex < infos.length) {
            this._hasMore = true;
            this._moreButton.label = _("More…");
            this._moreButton.show();
        } else if (hasToday && hasTomorrow) {
            this._moreButton.show();
            this._moreButton.label = _("Tomorrow");
        } else {
            this._moreButton.hide();
        }

        let attr = info.get_attribution();
        if (attr) {
            this._attribution.label = attr;
            this._attribution.show();
        } else {
            this._attribution.hide();
        }
    },

    _addOneInfo: function(info, row) {
        let [ok, date] = info.get_value_update();
        let datetime = GLib.DateTime.new_from_unix_local(date);

        let timeSetting = this._settings.get_string('clock-format');
        let timeFormat = null;

        if (timeSetting == '12h')
            // Translators: this is a time format without date used for AM/PM
            timeFormat = _("%l∶%M %p");
        else
            // Translators: this is a time format without date used for 24h mode
            timeFormat = _("%R");

        let label = new Gtk.Label({ label: datetime.format(timeFormat),
                                    visible: true,
                                    xalign: 1.0 });
        label.get_style_context().add_class('dim-label');
        this._grid.attach(label, 0, row, 1, 1);
        this._infoWidgets.push(label);

        let image = new Gtk.Image({ icon_name: info.get_symbolic_icon_name(),
                                    icon_size: Gtk.IconSize.MENU,
                                    use_fallback: true,
                                    visible: true });
        this._grid.attach(image, 1, row, 1, 1);
        this._infoWidgets.push(image);

        let conditions = new Gtk.Label({ label: Util.getWeatherConditions(info),
                                         visible: true,
                                         xalign: 0.0 });
        this._grid.attach(conditions, 2, row, 1, 1);
        this._infoWidgets.push(conditions);
    },

    _updateHeadline: function() {
        // Show today if we have it

        let date = GLib.DateTime.new_now_local();
        if (this._tomorrow)
            date = date.add_days(1);

        if (this._tomorrow)
            this._headline.label = '<b>' + _("Forecast for Tomorrow") + '</b>';
        else
            this._headline.label = '<b>' + _("Forecast for Today") + '</b>';

        this._subline.label = date.format(_("%B %d"));
    },

    _changeView: function() {
        if (this._hasMore) {
            this._hasMore = false;
            this._grid.remove(this._moreButton);

            let hasToday = this._trimmedToday.length > 0;
            let hasTomorrow = this._trimmedTomorrow.length > 0;

            let infos = hasToday ? this._trimmedToday : this._trimmedTomorrow;

            let i;
            for (i = this._trimmedIndex; i < infos.length; i++) {
                let info = infos[i];
                this._addOneInfo(info, i + 2);
            }
            this._trimmedIndex = i;

            this._grid.attach(this._moreButton, 2, i+2, 1, 1);

            if (hasToday && hasTomorrow) {
                this._moreButton.show();
                this._moreButton.label = _("Tomorrow");
            } else {
                this._moreButton.hide();
            }
        } else {
            this.clear();

            let hasToday = this._trimmedToday.length > 0;
            let hasTomorrow = this._trimmedTomorrow.length > 0;
            let infos;

            if (this._tomorrow && hasToday) {
                infos = this._trimmedToday;
                this._tomorrow = false;
            } else if (!this._tomorrow && hasTomorrow) {
                infos = this._trimmedTomorrow;
                this._tomorrow = true;
            }
            this._updateHeadline();

            let i;
            for (i = 0; i < infos.length; i++) {
                let info = infos[i];
                this._addOneInfo(info, i + 2);
            }
            this._trimmedIndex = i;

            this._grid.attach(this._moreButton, 2, i+2, 1, 1);

            if (hasToday && hasTomorrow) {
                this._moreButton.show();

                if (this._tomorrow)
                    this._moreButton.label = _("Today");
                else
                    this._moreButton.label = _("Tomorrow");
            } else {
                this._moreButton.hide();
            }

        }
    },
});