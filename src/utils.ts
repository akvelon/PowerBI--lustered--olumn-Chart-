'use strict';

import {Selection} from 'd3-selection';
import {
    AxisRangeType,
    categoryAxisSettings,
    categoryLabelsSettings,
    LabelOrientation,
    valueAxisSettings,
    VisualSettings,
} from './settings';
import {IAxes, ISize, VisualData, VisualDataPoint, VisualMeasureMetadata} from './visualInterfaces';

export type d3Selection<T> = Selection<any, T, any, any>;
export type d3Update<T> = Selection<any, T, any, any>;
export type d3Group<T> = Selection<any, T, any, any>;

import powerbiApi from 'powerbi-visuals-api';
import DataViewMetadataColumn = powerbiApi.DataViewMetadataColumn;
import DataView = powerbiApi.DataView;

import {axis} from 'powerbi-visuals-utils-chartutils';

import {
    textMeasurementService as TextMeasurementService,
    interfaces,
    valueFormatter as ValueFormatter,
} from 'powerbi-visuals-utils-formattingutils';
import TextProperties = interfaces.TextProperties;
import IValueFormatter = ValueFormatter.IValueFormatter;

import {valueType} from 'powerbi-visuals-utils-typeutils';

import * as visualUtils from './utils';

import {Field} from './dataViewConverter';
import {IAxisProperties} from 'powerbi-visuals-utils-chartutils/lib/axis/axisInterfaces';
import {max, min} from 'd3-array';
import {
    createFormatter,
    getTextProperties,
    getTextPropertiesForHeightCalculation,
    getValueForFormatter,
} from './utils/formattingUtils';
import {DataLabelHelper} from './utils/dataLabelHelper';

const DisplayUnitValue: number = 1;

export function calculateBarCoordianatesByData(data: VisualData, settings: VisualSettings, barHeight: number, isSmallMultiple: boolean = false): void {
    const dataPoints: VisualDataPoint[] = data.dataPoints;
    const axes: IAxes = data.axes;

    const legendDataPointsCount: number = data.legendData
    && data.legendData.dataPoints ? data.legendData.dataPoints.length : 1;

    this.calculateBarCoordianates(dataPoints, legendDataPointsCount, axes, settings, barHeight, isSmallMultiple);
}

export function calculateBarCoordianates(dataPoints: VisualDataPoint[],
                                         clustersCount: number,
                                         axes: IAxes,
                                         settings: VisualSettings,
                                         dataPointThickness: number,
                                         isSmallMultiple: boolean = false): void {

    const categoryAxisIsContinuous: boolean = !!(axes.xIsScalar && settings.categoryAxis.axisType !== 'categorical');

    const skipCategoryStartEnd: boolean = isSmallMultiple && settings.categoryAxis.rangeType !== AxisRangeType.Custom;

    const categoryAxisStartValue: number = categoryAxisIsContinuous && settings.categoryAxis.start ? settings.categoryAxis.start : -Number.MAX_VALUE;
    const categoryAxisEndValue: number = categoryAxisIsContinuous && settings.categoryAxis.end ? settings.categoryAxis.end : Number.MAX_VALUE;

    dataPointThickness = dataPoints.length > 2 ? dataPointThickness : dataPointThickness / 2;

    dataPoints.forEach(point => {
        let width = 0;
        if (axes.xIsScalar && categoryAxisIsContinuous) {
            const start = skipCategoryStartEnd ? null : settings.categoryAxis.start,
                end = skipCategoryStartEnd ? null : settings.categoryAxis.end;

            width = start != null && start > point.category || dataPointThickness < 0 ? 0 : dataPointThickness / clustersCount;
            width = end != null && end <= point.category ? 0 : width;
        } else {
            width = axes.x.scale.bandwidth() / clustersCount;
        }

        if (categoryAxisIsContinuous) {
            const categoryvalueIsInRange: boolean = point.category >= categoryAxisStartValue && point.category <= categoryAxisEndValue;
            if (!categoryvalueIsInRange) {
                setZeroCoordinatesForPoint(point);
                return;
            }
        }

        let x: number = axes.x.scale(point.category);
        if (categoryAxisIsContinuous) {
            x -= width * clustersCount / 2;
        }

        if (point.shiftValue > axes.y.dataDomain[1]) {
            setZeroCoordinatesForPoint(point);
            return;
        }

        if (clustersCount > 1) {
            x += width * point.shiftValue;
        }

        const minValue: number = axes.y.dataDomain[0],
            maxValue: number = axes.y.dataDomain[1];

        let fromValue: number = point.value >= 0 ? 0 : point.value;

        if (fromValue < minValue) {
            fromValue = minValue;
        } else if (fromValue > maxValue) {
            setZeroCoordinatesForPoint(point);
            return;
        }

        const fromCoordinate: number = axes.y.scale(fromValue);

        let toValue = point.value >= 0 ? point.value : 0;

        if (toValue < minValue) {
            setZeroCoordinatesForPoint(point);
            return;
        } else if (toValue > maxValue) {
            toValue = maxValue;
        }

        const toCoordinate: number = axes.y.scale(toValue);

        if (toCoordinate >= fromCoordinate) {
            setZeroCoordinatesForPoint(point);
            return;
        }

        let volume: number = fromCoordinate - toCoordinate;
        if (volume < 1 && volume !== 0) {
            volume = 1;
        }

        point.barCoordinates = {
            height: volume,
            width: width,
            x,
            y: toCoordinate,
        };
    });

    //if (axes.xIsScalar && settings.categoryAxis.axisType !== "categorical") {
    //  recalculateThicknessForContinuous(dataPoints, thickness, clustersCount);
    // }
}

function setZeroCoordinatesForPoint(point: VisualDataPoint): void {
    point.barCoordinates = {height: 0, width: 0, x: 0, y: 0};
}

export function recalculateThicknessForContinuous(dataPoints: VisualDataPoint[], dataPointThickness: number, clustersCount: number) {
    let minWidth: number = 1.5,
        minDistance: number = Number.MAX_VALUE;

    const sortedDataPoints: VisualDataPoint[] = dataPoints.sort((a, b) => {
        return a.barCoordinates.x - b.barCoordinates.x;
    });

    let firstDataPoint: VisualDataPoint = sortedDataPoints[0];

    for (let i = 1; i < sortedDataPoints.length; ++i) {
        const distance: number = sortedDataPoints[i].barCoordinates.x - firstDataPoint.barCoordinates.x;

        minDistance = distance < minDistance ? distance : minDistance;
        firstDataPoint = sortedDataPoints[i];
    }

    if (minWidth < minDistance && minDistance < dataPointThickness) {
        minWidth = minDistance;
    } else {
        minWidth = dataPointThickness;
    }

    if (dataPointThickness && dataPointThickness !== minWidth) {
        sortedDataPoints.forEach(x => {
            const oldWidth: number = x.barCoordinates.width;
            x.barCoordinates.width = oldWidth ? minWidth : 0;
            x.barCoordinates.x = x.barCoordinates.x + dataPointThickness / 2 - oldWidth * x.shiftValue;

            x.barCoordinates.x -= minWidth / 2;

            if (clustersCount > 1) {
                x.barCoordinates.x += minWidth * x.shiftValue;
            }
        });
    }
}

export function calculateLabelCoordinates(data: VisualData,
                                          settings: categoryLabelsSettings,
                                          metadata: VisualMeasureMetadata,
                                          chartHeight: number,
                                          isLegendRendered: boolean,
                                          dataPoints: VisualDataPoint[] = null) {
    if (!settings.show) {
        return;
    }

    const dataPointsArray: VisualDataPoint[] = dataPoints || data.dataPoints;

    const dataLabelFormatter: IValueFormatter = createFormatter(settings.displayUnits,
        settings.precision,
        metadata.cols.value,
        getValueForFormatter(data));

    const textPropertiesForWidth: TextProperties = getTextProperties(settings);
    const textPropertiesForHeight: TextProperties = getTextPropertiesForHeightCalculation(settings);

    dataPointsArray.forEach(dataPoint => {
        const formattedText: string = dataLabelFormatter.format(dataPoint.value);
        textPropertiesForHeight.text = formattedText;

        const isHorizontal: boolean = settings.orientation === LabelOrientation.Horizontal;

        const textHeight: number = isHorizontal ?
            TextMeasurementService.estimateSvgTextHeight(textPropertiesForWidth)
            : TextMeasurementService.measureSvgTextWidth(textPropertiesForWidth, formattedText);

        const textWidth: number = isHorizontal ?
            TextMeasurementService.measureSvgTextWidth(textPropertiesForWidth, formattedText)
            : TextMeasurementService.estimateSvgTextHeight(textPropertiesForWidth);

        const barWidth: number = dataPoint.barCoordinates.width;

        if (settings.overflowText || textWidth +
            (settings.showBackground ? DataLabelHelper.labelBackgroundHeightPadding : 0) < barWidth) {

            const dx: number = dataPoint.barCoordinates.x + dataPoint.barCoordinates.width / 2 + (isHorizontal ? -(textWidth) / 2 : (textWidth) / 3);
            const dy: number = DataLabelHelper.calculatePositionShift(settings, textHeight, dataPoint, chartHeight);

            if (dy !== null) {
                dataPoint.labelCoordinates = {
                    x: dx,
                    y: dy,
                    width: textWidth,
                    height: textHeight,
                };
            } else {
                dataPoint.labelCoordinates = null;
            }
        } else {
            dataPoint.labelCoordinates = null;
        }
    });
}

export function getNumberOfValues(dataView: DataView): number {
    const columns: DataViewMetadataColumn[] = dataView.metadata.columns;
    let valueFieldsCount: number = 0;

    for (const columnName in columns) {
        const column: DataViewMetadataColumn = columns[columnName];

        if (column.roles && column.roles[Field.Value]) {
            ++valueFieldsCount;
        }
    }

    return valueFieldsCount;
}

export function getLineStyleParam(lineStyle) {
    let strokeDasharray;

    switch (lineStyle) {
        case 'solid':
            strokeDasharray = 'none';
            break;
        case 'dashed':
            strokeDasharray = '7, 5';
            break;
        case 'dotted':
            strokeDasharray = '2, 2';
            break;
    }

    return strokeDasharray;
}

export function getUnitType(xAxis: IAxisProperties): string | null {
    if (xAxis.formatter
        && xAxis.formatter.displayUnit
        && xAxis.formatter.displayUnit.value > DisplayUnitValue) {

        return xAxis.formatter.displayUnit.title;
    }

    return null;
}

export function getTitleWithUnitType(title, axisStyle, axis: IAxisProperties): string | undefined {
    const unitTitle = visualUtils.getUnitType(axis) || 'No unit';
    switch (axisStyle) {
        case 'showUnitOnly': {
            return unitTitle;
        }
        case 'showTitleOnly': {
            return title;
        }
        case 'showBoth': {
            return `${title} (${unitTitle})`;
        }
    }
}

export const DimmedOpacity: number = 0.4;
export const DefaultOpacity: number = 1.0;

export function getFillOpacity(selected: boolean, highlight: boolean, hasSelection: boolean, hasPartialHighlights: boolean): number {
    if ((hasPartialHighlights && !highlight) || (hasSelection && !selected)) {
        return DimmedOpacity;
    }

    return DefaultOpacity;
}

const CategoryMinWidth: number = 1;
const CategoryMaxWidth: number = 450;

export function calculateDataPointThickness(
    visualDataPoints: VisualDataPoint[],
    visualSize: ISize,
    categoriesCount: number,
    categoryInnerPadding: number,
    settings: VisualSettings,
    isCategorical: boolean = false,
    isSmallMultiple: boolean = false): number {

    const currentThickness = visualSize.width / categoriesCount;
    let thickness: number = 0;

    if (isCategorical || settings.categoryAxis.axisType === 'categorical') {
        const innerPadding: number = categoryInnerPadding / 100;
        thickness = min([CategoryMaxWidth, max([CategoryMinWidth, currentThickness])]) * (1 - innerPadding);
    } else {
        let dataPoints = [...visualDataPoints];

        const skipStartEnd: boolean = isSmallMultiple && settings.categoryAxis.rangeType !== AxisRangeType.Custom;

        const start = skipStartEnd ? null : settings.categoryAxis.start,
            end = skipStartEnd ? null : settings.categoryAxis.end;

        if (start != null || end != null) {
            dataPoints = dataPoints.filter(x => start != null ? x.value >= start : true
            && end != null ? x.value <= end : true);
        }

        const dataPointsCount: number = dataPoints.map(x => x.category).filter((v, i, a) => a.indexOf(v) === i).length;

        if (dataPointsCount < 3) {
            const devider: number = 8;
            thickness = visualSize.height / devider;
        } else if (dataPointsCount < 4) {
            const devider: number = 3.75;
            thickness = visualSize.width / devider;
        } else {
            const devider: number = 3.75 + 1.25 * (dataPointsCount - 3);
            thickness = visualSize.width / devider;
        }
    }

    return thickness;
}

export function getLabelsMaxWidth(group: d3Group<any>): number | undefined {
    const widths: Array<number> = [];

    group.nodes().forEach((item: any) => {
        const dimension = item.getBoundingClientRect();
        widths.push(max([dimension.width, dimension.height]));
    });

    if (!group || group.size() === 0) {
        widths.push(0);
    }

    return max(widths);
}

export function getLabelsMaxHeight(group: d3Group<any>): number | undefined {
    const heights: Array<number> = [];

    group.nodes().forEach((item: any) => {
        const dimension: ClientRect = item.getBoundingClientRect();
        heights.push(dimension.height);
    });

    if (!group || group.size() === 0) {
        heights.push(0);
    }

    return max(heights);
}

export function GetYAxisTitleHeight(valueSettings: valueAxisSettings): number {

    const textPropertiesForHeight: TextProperties = {
        fontFamily: valueSettings.titleFontFamily,
        fontSize: valueSettings.titleFontSize.toString(),
    };

    return TextMeasurementService.estimateSvgTextHeight(textPropertiesForHeight);
}

export function GetXAxisTitleHeight(categorySettings: categoryAxisSettings): number {

    const textPropertiesForHeight: TextProperties = {
        fontFamily: categorySettings.titleFontFamily,
        fontSize: categorySettings.titleFontSize.toString(),
    };

    return TextMeasurementService.estimateSvgTextHeight(textPropertiesForHeight);
}

export function isSelected(selected: boolean, highlight: boolean, hasSelection: boolean, hasPartialHighlights: boolean): boolean {
    return !(hasPartialHighlights && !highlight || hasSelection && !selected);
}

export function compareObjects(obj1: any[], obj2: any[], property: string): boolean {
    let isEqual: boolean = false;

    if (obj1.length > 0 && obj2.length > 0 && obj1.length === obj2.length) {
        isEqual = true;
        obj1.forEach((o1, i) => {
            obj2.forEach((o2, j) => {
                if (i === j) {
                    isEqual = isEqual && o1[property] === o2[property];
                }
            });
        });
    } else if (obj1.length === 0 && obj2.length === 0) {
        isEqual = true;
    }

    return isEqual;
}

export function smallMultipleLabelRotationIsNeeded(
    xAxisSvgGroup: d3Selection<HTMLOrSVGElement>,
    barHeight: number,
    categoryAxisSettings: categoryAxisSettings,
    maxLabelHeight: number,
): boolean {
    const rangeBand = barHeight;

    let maxLabelWidth: number = 0;

    xAxisSvgGroup.selectAll('text').each(function () {
        const labelWidth: number = (<SVGTextElement>this).getBoundingClientRect().width;

        maxLabelWidth = Math.max(maxLabelWidth, labelWidth > maxLabelHeight ? maxLabelHeight : labelWidth);
    });

    return maxLabelWidth > rangeBand;
}

export function isScalar(column: DataViewMetadataColumn) {
    const categoryType: valueType.ValueType = axis.getCategoryValueType(column);
    const isOrdinal: boolean = axis.isOrdinal(categoryType);

    return !isOrdinal;
}

export function categoryIsScalar(metadata: VisualMeasureMetadata): boolean {
    const categoryType: valueType.ValueType = axis.getCategoryValueType(metadata.cols.category);
    const isOrdinal: boolean = axis.isOrdinal(categoryType);

    return !isOrdinal;
}
