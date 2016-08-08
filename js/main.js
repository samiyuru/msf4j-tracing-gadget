gadgets.util.registerOnLoadHandler(function () {
    gadgets.window.adjustHeight();
});

$(document).ready(function () {
    var analyticsUrl = "/analytics/tables/MSF4J-TRACING";
    var username = "admin";
    var password = "admin";

    var traceTreeVwElm = $("#trace-tree-view");
    var traceTreeVw = initTraceTreeView(
        traceTreeVwElm,
        traceTreeVwElm.find(".container").first(),
        traceTreeVwElm.find(".close").first()
    );

    loadTraces(analyticsUrl, username, password, function (data) {
        var traceGroups = groupTraceEvents(data);
        renderTraceGroups(traceGroups, $('#results'), function (traceTree) {
            traceTreeVw.show(traceTree);
        });
    }, function (jqXHR) {
        var errorData = $.parseJSON(jqXHR.responseText);
        if (errorData) {
            alert(errorData.message);
        } else {
            alert("Failed to load traces");
        }
    });
});

function initTraceTreeView(viewElm, containerElm, closeBtnElm) {

    hide();

    closeBtnElm.click(function () {
        hide();
    });

    function clean() {
        containerElm.empty();
    }

    function hide() {
        clean();
        viewElm.hide();
    }

    function show(traceTree) {
        viewElm.show();
        renderTraceTree(traceTree, buildOriginTraceBarVw(traceTree, traceTree.timeRange, 0));
    }

    function buildOriginTraceBarVw(traceTree, timeRange, callDepth) {
        var originTraceBarVw = buildTraceBarVw(traceTree, timeRange, callDepth);
        containerElm.append(originTraceBarVw.traceBarElm);
        return originTraceBarVw;
    }

    function renderTraceTree(traceTree, parentTraceBarVw) {
        var children = traceTree.children;
        var childrenLen = children.length;
        for (var i = 0; i < childrenLen; i++) {
            var child = children[i];
            var childTraceBarVw = buildTraceBarVw(
                child,
                parentTraceBarVw.timeRange,
                // Do not indent the service call of a client
                (child.type == "STS") ? parentTraceBarVw.callDepth : parentTraceBarVw.callDepth + 1
            );
            parentTraceBarVw.addChildTraceBar(childTraceBarVw);
            renderTraceTree(child, childTraceBarVw);
        }
    }

    return {
        show: function (traceTree) {
            show(traceTree);
        }
    };
}

function buildTraceBarVw(traceData, timeRange, callDepth) {
    var traceBarElm = $(
        Mustache.render(
            $('#trace-bar').html()
        )
    );
    var childContainer = traceBarElm.find(".child-container").first();
    var leftPane = traceBarElm.find(".left-pane").first();
    var bar = traceBarElm.find(".bar").first();

    setName(traceData.instanceName);
    setTimeRange(traceData.time, traceData.end.time, timeRange.start, timeRange.end);
    setCallDepth(callDepth);

    function setTimeRange(startTime, endTime, rootStart, rootEnd) {
        var left = 100 * (startTime - rootStart) / (rootEnd - rootStart);
        var width = 100 * (endTime - startTime) / (rootEnd - rootStart);
        bar.css({
            left: left + "%",
            width: width + "%"
        });
    }

    function setName(name) {
        leftPane.html(name);
    }

    function addChildTraceBar(traceBarVw) {
        childContainer.append(traceBarVw.traceBarElm);
    }

    function setCallDepth(callDepth) {
        leftPane.css("margin-left", callDepth * 15);
    }

    return {
        traceBarElm: traceBarElm,
        timeRange: timeRange,
        callDepth: callDepth,
        addChildTraceBar: function (traceBarVw) {
            addChildTraceBar(traceBarVw);
        }
    };
}

function loadTraces(url, username, password, callback, errorCallback) {
    $.ajax({
        type: "GET",
        beforeSend: function (request) {
            if (!window.btoa) {
                window.btoa = $.base64.btoa;
            }
            request.setRequestHeader("Authorization", "Basic " + btoa(username + ":" + password));
        },
        url: url,
        data: "json",
        processData: false,
        success: callback,
        error: errorCallback
    });
}

function renderTraceGroups(traceGroups, parentElm, showTraceTree) {
    itrValidTraceGroups(traceGroups, function (traceGroup) {
        var traceGroupElm = $(
            Mustache.render(
                $('#trace-group').html(),
                traceGroup
            )
        );
        traceGroupElm.click(function () {
            showTraceTree(traceGroup.getTraceTree());
        });
        parentElm.append(traceGroupElm);
    });
}

function groupTraceEvents(data) {
    var traceGroups = {};
    var dataLen = data.length;
    for (var i = 0; i < dataLen; i++) {
        var event = data[i].values;
        if (!event || !event.originId) {
            // Ignore the event if it is null or does not contain the original event ID
            // Or the original event Id is invalid
            continue;
        }
        var eventDate = new Date(event.time);
        event.timeStr = eventDate.toLocaleString();
        var traceGroup = traceGroups[event.originId];
        if (!traceGroup) {
            traceGroups[event.originId] = traceGroup = {
                isBuilt: false,
                timeRange: {
                    // The time range that the trace spans
                    // Required for drawing gantt bars to scale
                    start: Number.MAX_VALUE,
                    end: 0,
                    addStart: function (startTime) {
                        if (this.start > startTime) {
                            this.start = startTime;
                        }
                    },
                    addEnd: function (endTime) {
                        if (this.end < endTime) {
                            this.end = endTime;
                        }
                    }
                },
                origin: null,
                events: {
                    start: {},
                    end: {}
                },
                addEvent: function (event) {
                    if (event.type == "STS" || event.type == "CTS") {
                        if (event.traceId == event.originId) {
                            // If this condition is met this is the first event of the trace
                            if (validateOriginEvent(event)) {
                                this.origin = event;
                                this.timeRange.addStart(event.time);
                            }
                        } else {
                            var children = this.events.start[event.parentId];
                            if (!children) {
                                this.events.start[event.parentId] = children = [];
                            }
                            children.push(event);
                            this.timeRange.addStart(event.time);
                        }
                    } else {
                        this.events.end[event.traceId] = event;
                        this.timeRange.addEnd(event.time);
                    }
                },
                getTraceTree: function () {
                    if (this.isBuilt) {
                        return this.origin;
                    } else {
                        var startEvents = this.events.start;
                        var endEvents = this.events.end;
                        var origin = this.origin;
                        origin.timeRange = this.timeRange;
                        var parents = [];
                        parents.push(origin);
                        while (Object.keys(startEvents).length > 0 || parents.length > 0) {
                            var parent = parents.shift();
                            parent.end = endEvents[parent.traceId];
                            parent.children = startEvents[parent.traceId] || [];
                            delete startEvents[parent.traceId];
                            parent.children.sort(function (a, b) {
                                return a.time - b.time;
                            });
                            var childrenLen = parent.children.length;
                            for (var i = 0; i < childrenLen; i++) {
                                var child = parent.children[i];
                                child.end = endEvents[child.traceId];
                                parents.push(child);
                            }
                        }
                        this.isBuilt = true;
                        this.events = null;
                        console.log("TraceTree:");
                        console.log(origin);
                        return origin;
                    }
                }
            };
        }
        traceGroup.addEvent(event);
    }
    console.log("Trace groups:");
    console.log(traceGroups);
    return traceGroups;
}

function itrValidTraceGroups(traceGroups, callback) {
    for (var key in traceGroups) {
        if (!traceGroups.hasOwnProperty(key)) {
            continue;
        }
        var traceGroup = traceGroups[key];
        if (traceGroup.origin && validateOriginEvent(traceGroup.origin)) {
            callback(traceGroup);
        }
    }
}

function validateOriginEvent(event) {
    return event.instanceName && event.time && event.traceId && event.url && event.httpMethod && !event.parentId;
}
