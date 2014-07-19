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

const Gd = imports.gi.Gd;
const GdkPixbuf = imports.gi.GdkPixbuf;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const GWeather = imports.gi.GWeather;
const Lang = imports.lang;

const Params = imports.misc.params;
const Util = imports.misc.util;

const Columns = {
    ID: Gd.MainColumns.ID,
    URI: Gd.MainColumns.URI,
    PRIMARY_TEXT: Gd.MainColumns.PRIMARY_TEXT,
    SECONDARY_TEXT: Gd.MainColumns.SECONDARY_TEXT,
    ICON: Gd.MainColumns.ICON,
    MTIME: Gd.MainColumns.MTIME,
    SELECTED: Gd.MainColumns.SELECTED,
    PULSE: Gd.MainColumns.PULSE,
    LOCATION: Gd.MainColumns.LAST,
    INFO: Gd.MainColumns.LAST+1,
    AUTOMATIC: Gd.MainColumns.LAST+2
};
const ColumnTypes = {
    ID: String,
    URI: String,
    PRIMARY_TEXT: String,
    SECONDARY_TEXT: String,
    ICON: GdkPixbuf.Pixbuf,
    MTIME: GObject.Int,
    SELECTED: Boolean,
    PULSE: GObject.UInt,
    LOCATION: GWeather.Location,
    INFO: GWeather.Info,
    AUTOMATIC: Boolean
};
Util.assertEqual(Object.keys(Columns).length, Object.keys(ColumnTypes).length);
Util.assertEqual(Gd.MainColumns.LAST+3, Object.keys(ColumnTypes).length);

const ICON_SIZE = 128;

const WorldModel = new Lang.Class({
    Name: 'WorldModel',
    Extends: Gtk.ListStore,
    Signals: {
        'updated': { param_types: [ GWeather.Info ] },
        'no-locations': { param_types: [ Boolean ] },
        'no-cityview': { param_types: [] },
        'show-info': { param_types: [ GWeather.Info ] },
        'current-location-changed': { param_types: [ Boolean ] }
    },
    Properties: {
        'loading': GObject.ParamSpec.boolean('loading', '', '', GObject.ParamFlags.READABLE, false)
    },

    _init: function(world, enableGtk) {
        this.parent();
        this.set_column_types([ColumnTypes[c] for (c in ColumnTypes)]);
        this._world = world;

        this._settings = Util.getSettings('org.gnome.Weather.Application');

        this._providers = Util.getEnabledProviders();

        this._loadingCount = 0;

        this._infoList = [];

        this._enableGtk = enableGtk;

        this._settings.connect('changed::current-location', Lang.bind(this, this._currentLocationChanged));

        this._currentLocationInfo = null;

        this._currentlyLoadedInfo = null;
    },

    _currentLocationChanged: function() {
        let location = this._settings.get_value('current-location').deep_unpack();
        if (location) {
            location = this._world.deserialize(location);

            this._newCurrentLocationInfo = new GWeather.Info({ location: location,
                                                            enabled_providers: this._providers });
            if (this._currentLocationInfo) {
                if (!this._currentLocationInfo.location.equal(location)) {
                    this._newCurrentLocationInfo.connect('updated', Lang.bind(this, function(info) {
                        this._updateLoadingCount(-1);
                        this.emit('updated', this._newCurrentLocationInfo);
                    }));
                    this.updateInfo(this._newCurrentLocationInfo);
                    this._currentLocationInfo = this._newCurrentLocationInfo;
                }
            } else {
                this._newCurrentLocationInfo.connect('updated', Lang.bind(this, function(info) {
                    this._updateLoadingCount(-1);
                    this.emit('updated', this._newCurrentLocationInfo);
                }));
                this.updateInfo(this._newCurrentLocationInfo);
                this._currentLocationInfo = this._newCurrentLocationInfo;
            }
            this.emit('current-location-changed', this._currentlyLoadedInfo && this._currentlyLoadedInfo.location.equal(location));
        }
    },

    rowActivated: function(listbox, row) {
        let children = row.get_children();
        let grid = children[0];
        let gridChildren = children[0].get_children();
        this.emit('show-info', this._infoList[gridChildren[1].get_label()]);
        this._currentlyLoadedInfo = this._infoList[gridChildren[1].get_label()];
    },

    showRecent: function(listbox) {
        let row = listbox.get_row_at_index(0);
        if (row) {
            this.rowActivated(null, row);
            return;
        }
    },

    showCurrentLocation: function() {
        if (this._currentLocationInfo) {
            this.emit('show-info', this._currentLocationInfo);
            this._currentlyLoadedInfo = this._currentLocationInfo;
        }
    },

    fillListbox: function (listbox) {
        let locations = this._settings.get_value('locations').deep_unpack();
        if (locations.length == 0) {
            this.emit('no-locations', true);
        } else {
            this.emit('no-locations', false);
            for (let i = 0; i < locations.length && i < 5; i++) {
                let variant = locations[i];
                let location = this._world.deserialize(variant);
                this._addLocationInternalNew(location, listbox);
            }
        }
    },

    fillCityView: function() {
        let locations = this._settings.get_value('locations').deep_unpack();

        let location = this._settings.get_value('current-location').deep_unpack();

        if (location) {
            location = this._world.deserialize(location);
            this._currentLocationInfo = new GWeather.Info({ location: location,
                                                            enabled_providers: this._providers });
            this._currentLocationInfo = this._currentLocationInfo;
            this._currentLocationInfo.connect('updated', Lang.bind(this, function(info) {
                this._updateLoadingCount(-1);
                this.emit('updated', this._currentLocationInfo);
            }));
            this.updateInfo(this._currentLocationInfo);

            this.emit('show-info', this._currentLocationInfo);
            this._currentlyLoadedInfo = this._currentLocationInfo;
        } else if (locations.length > 0) {
            let variant = locations[locations.length-1];
            let location = this._world.deserialize(variant);
            this.emit('show-info', this._infoList[location.get_city_name()]);
            this._currentlyLoadedInfo = this._infoList[location.get_city_name()];
        } else {
            this.emit('no-cityview');
        }
    },

    _updateLoadingCount: function(delta) {
        let wasLoading = this._loadingCount > 0;
        this._loadingCount += delta;
        let isLoading = this._loadingCount > 0;

        if (wasLoading != isLoading)
            this.notify('loading');
    },

    updateInfo: function(info) {
        info.update();
        this._updateLoadingCount(+1);
    },

    get loading() {
        return this._loadingCount > 0;
    },

    _addLocationInternal: function(location, automatic) {
        let info = new GWeather.Info({ location: location,
                                       enabled_providers: this._providers });
        let iter;
        info.connect('updated', Lang.bind(this, function(info) {
            let secondary_text = Util.getWeatherConditions(info);
            if (this._enableGtk) {
                let icon = Util.loadIcon(info.get_symbolic_icon_name(), ICON_SIZE);
                this.set(iter,
                         [Columns.ICON, Columns.SECONDARY_TEXT],
                         [icon, secondary_text]);
            } else {
                this.set_value(iter, Columns.SECONDARY_TEXT, secondary_text);
            }

            this._updateLoadingCount(-1);
            this.emit('updated', info);
        }));
        this.updateInfo(info);

        let primary_text = location.get_city_name();

        iter = this.insert_with_valuesv(-1,
                                        [Columns.PRIMARY_TEXT,
                                         Columns.LOCATION,
                                         Columns.INFO,
                                         Columns.AUTOMATIC],
                                        [primary_text,
                                         location,
                                         info,
                                         automatic]);

        if (this._enableGtk) {
            let icon = Util.loadIcon('view-refresh-symbolic', ICON_SIZE);
            this.set_value(iter, Columns.ICON, icon);
        }
    },

    _addLocationInternalNew: function(location, listbox) {
        let grid = new Gtk.Grid({ orientation: Gtk.Orientation.HORIZONTAL,
                                  column_spacing: 15,
                                  margin_top: 6,
                                  margin_bottom: 6,
                                  column_homogeneous: true });

        let name = location.get_city_name();
        let locationLabel = new Gtk.Label({ label: name,
                                       use_markup: true,
                                       halign: Gtk.Align.START,
                                       visible: true });
        grid.attach(locationLabel, 0, 0, 1, 1);

        let conditionGrid = new Gtk.Grid({ orientation: Gtk.Orientation.HORIZONTAL,
                                           column_spacing: 1,
                                           column_homogeneous: true });

        let tempLabel = new Gtk.Label({ use_markup: true,
                                        halign: Gtk.Align.END,
                                        visible: true });
        conditionGrid.attach(tempLabel, 0, 0, 1, 1);

        let image = new Gtk.Image({ icon_size: Gtk.IconSize.LARGE_TOOLBAR,
                                    use_fallback: true,
                                    halign: Gtk.Align.END,
                                    visible: true });
        conditionGrid.attach(image, 1, 0, 1, 1);

        conditionGrid.show();
        grid.attach(conditionGrid, 1, 0, 1, 1);

        grid.show();
        listbox.prepend(grid);

        let info = new GWeather.Info({ location: location,
                                       enabled_providers: this._providers });
        this._infoList[locationLabel.get_label()] = info;

        info.connect('updated', Lang.bind(this, function(info) {
            tempLabel.label = info.get_temp_summary();
            image.icon_name = info.get_symbolic_icon_name();

            this._updateLoadingCount(-1);
            this.emit('updated', info);
        }));
        this.updateInfo(info);
    },

    addNewLocation: function(entry, listbox) {
        let newLocation = entry.location;
        if (newLocation) {
            let locations = this._settings.get_value('locations').deep_unpack();
            for (let i = 0; i < locations.length; i++) {
                let location = this._world.deserialize(locations[i]);
                if (location.equal(newLocation)) {
                    this.emit('show-info', this._infoList[location.get_city_name()]);
                    this._currentlyLoadedInfo = this._infoList[location.get_city_name()];
                    entry.location = null;
                    return;
                }
            }

            locations.push(newLocation.serialize());

            if (locations.length > 5) {
                locations.splice(0, 1);
                let children = listbox.get_children();
                children[children.length-1].destroy();
            }

            this._settings.set_value('locations', new GLib.Variant('av', locations));
            this._addLocationInternalNew(newLocation, listbox);
            this.emit('no-locations', false);
            this.emit('show-info', this._infoList[newLocation.get_city_name()]);
            this._currentlyLoadedInfo = this._infoList[newLocation.get_city_name()];
            entry.location = null;
        }
    },

    _addSavedLocation: function(location) {
        let newLocations = this._settings.get_value('locations').deep_unpack();
        newLocations.push(location.serialize());
        this._settings.set_value('locations', new GLib.Variant('av', newLocations));
    },

    getAllSavedLocations: function() {
        let locations = this._settings.get_value('locations').deep_unpack();
        let returnValue = [];

        for (let i = 0; i < locations.length; i++) {
            let variant = locations[i];
            if (variant == null) {
                log('null stored in GSettings?');
                continue;
            }

            returnValue.push(this._world.deserialize(variant));
        }

        return returnValue;
    },

    getLocationInfo: function(location) {
        let [ok, iter] = this.get_iter_first();
        while (ok) {
            let storedLocation = this.get_value(iter, Columns.LOCATION);
            if (storedLocation.equal(location))
                return this.get_value(iter, Columns.INFO);

            ok = this.iter_next(iter);
        }

        return null;
    },

    addLocation: function(location, saved) {
        if (saved)
            this._addSavedLocation(location);
        else
            this._addLocationInternal(location, true);
    },

    removeLocation: function(iter) {
        let auto = this.get_value(iter, Columns.AUTOMATIC);
        if (auto) {
            this.remove(iter);
            return;
        }

        let location = this.get_value(iter, Columns.LOCATION);
        let variant = location.serialize();

        let newLocations = this._settings.get_value('locations').deep_unpack();

        for (let i = 0; i < newLocations.length; i++) {
            if (newLocations[i].equal(variant)) {
                newLocations.splice(i, 1);
                break;
            }
        }

        this._settings.set_value('locations', new GLib.Variant('av', newLocations));
    },
});

const WorldIconView = new Lang.Class({
    Name: 'WorldView',
    Extends: Gd.MainView,

    _init: function(params) {
        params = Params.fill(params, { view_type: Gd.MainViewType.ICON });
        this.parent(params);
        this.get_accessible().accessible_name = _("Cities");

        this.connect('selection-mode-request', Lang.bind(this, function() {
            this.selection_mode = true;
        }));
    }
});

const WorldContentView = new Lang.Class({
    Name: 'WorldContentView',
    Extends: Gtk.Popover,
    Properties: { 'empty': GObject.ParamSpec.boolean('empty', '', '', GObject.ParamFlags.READABLE, false) },

    _init: function(model, params) {
        params = Params.fill(params, { hexpand: false, vexpand: false });
        this.parent(params);

        this.get_accessible().accessible_name = _("World view");

        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/Weather/Application/places-popover.ui');

        let grid = builder.get_object('popover-grid');
        this.add(grid);

        this.initialGrid = builder.get_object('initial-grid');

        let stackPopover = builder.get_object('popover-stack');

        this.model = model;
        this.model.connect('no-locations', Lang.bind(this, function(model, empty) {
            if (empty) {
                stackPopover.set_visible_child_name("search-grid");
            } else {
                stackPopover.set_visible_child_name("locations-grid");
            }
        }));

        let listbox = builder.get_object('locations-list-box');

        let initialGridLocEntry = builder.get_object('initial-grid-location-entry');
        initialGridLocEntry.connect('notify::location', Lang.bind(this, function(entry) {
            this._locationChanged(entry, listbox);
        }));

        let locationEntry = builder.get_object('location-entry');
        locationEntry.connect('notify::location', Lang.bind(this, function(entry) {
            this._locationChanged(entry, listbox)
        }));

        this.model.fillListbox(listbox);

        this.connect('notify::visible', Lang.bind(this, function() {
            listbox.set_selection_mode(0);
            locationEntry.grab_focus();
            listbox.set_selection_mode(1);
        }));

        let autoLocSwitch = builder.get_object('auto-location-switch');

        let handlerId = autoLocSwitch.connect('notify::active', Lang.bind(this, function() {
                            if (!autoLocSwitch.get_active()) {
                                this.model.showRecent(listbox);
                            }
                            else {
                                model.showCurrentLocation();
                            }
                            this.hide();
                        }));

        autoLocSwitch.set_sensitive(false);

        listbox.connect('row-activated', Lang.bind(this, function(listbox, row) {
            this.hide();
            this.model.rowActivated(listbox, row);
            GObject.signal_handler_block(autoLocSwitch, handlerId);
            autoLocSwitch.set_active(false);
            GObject.signal_handler_unblock(autoLocSwitch, handlerId);
        }));

        this.model.connect('current-location-changed', Lang.bind(this, function(model, active) {
            autoLocSwitch.set_sensitive(true);
            GObject.signal_handler_block(autoLocSwitch, handlerId);
            autoLocSwitch.set_active(active);
            GObject.signal_handler_unblock(autoLocSwitch, handlerId);
        }));

        this.iconView = new WorldIconView({ model: model, visible: true });
    },

    _locationChanged: function(entry, listbox) {
        this.model.addNewLocation(entry, listbox);
    },

    get empty() {
        return this._empty;
    },

    _onDestroy: function() {
        if (this._rowInsertedId) {
            this.model.disconnect(this._rowInsertedId);
            this._rowInsertedId = 0;
        }
        if (this._rowDeletedId) {
            this.model.disconnect(this._rowDeletedId);
            this._rowDeletedId = 0;
        }
    },

    _updateEmpty: function() {
        let [ok, iter] = this.model.get_iter_first();

        if (!ok != this._empty) {
            if (ok) {
                this.remove(this._placeHolder);
                this.add(this.iconView);
            } else {
                this.remove(this.iconView);
                this.add(this._placeHolder);
            }

            this._empty = !ok;
            this.notify('empty');
        }
    }
});
