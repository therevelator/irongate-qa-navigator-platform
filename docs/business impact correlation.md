# Business Impact Correlation

## Overview

The Business Impact Correlation page analyzes the relationship between software quality metrics and business outcomes. It visualizes how quality improvements translate to revenue impact, customer satisfaction, and feature adoption rates.

## Page Structure

### Header Statistics

The header displays four key metrics aggregated across all quality metrics:

#### Average Correlation (0.73)
**Calculation:**
```javascript
avgCorrelation = impactData.reduce((acc, d) => acc + d.correlation_strength, 0) / impactData.length
```
- **Source:** `/api/analytics/business-impact?days=30`
- **Range:** 0.00 to 1.00 (0 = no correlation, 1 = perfect correlation)
- **Interpretation:**
  - 0.00-0.30: Weak correlation
  - 0.31-0.70: Moderate correlation
  - 0.71-1.00: Strong correlation

#### Total Revenue Impact ($4.18 M)
**Calculation:**
```javascript
totalRevenue = impactData.reduce((acc, d) => acc + d.revenue_impact, 0)
displayValue = (totalRevenue / 1000000).toFixed(2) + " M"
```
- **Source:** Sum of all `revenue_impact` values from business impact data
- **Units:** Displayed in millions (M) for readability
- **Time Period:** Last 30 days

#### Average NPS (81.2)
**Calculation:**
```javascript
avgNPS = impactData.reduce((acc, d) => acc + d.customer_satisfaction, 0) / impactData.length
```
- **Source:** Average of `customer_satisfaction` scores across all metrics
- **Range:** Typically 0-100 (Net Promoter Score)
- **Interpretation:**
  - 80+: Excellent customer satisfaction
  - 70-79: Good customer satisfaction
  - 60-69: Needs improvement

#### Average Adoption Rate (72.8%)
**Calculation:**
```javascript
avgAdoption = impactData.reduce((acc, d) => acc + d.feature_adoption_rate, 0) / impactData.length
```
- **Source:** Average of `feature_adoption_rate` percentages across all metrics
- **Units:** Percentage (%)
- **Range:** 0-100%

## Main Content Components

### Correlation Matrix (Scatter Chart)

**Purpose:** Visualizes the relationship between quality scores and revenue impact.

**Data Preparation:**
```javascript
const correlationData = impactData.map(item => ({
  name: item.metric_name,
  quality: item.quality_score,
  revenue: item.revenue_impact / 1000, // Convert to K for chart
  satisfaction: item.customer_satisfaction,
  adoption: item.feature_adoption_rate,
  correlation: item.correlation_strength
}));
```

**Chart Configuration:**
- **X-Axis:** Quality Score (60-100 range)
- **Y-Axis:** Revenue Impact ($K)
- **Bubble Size:** Correlation strength (Z-axis)
- **Colors:**
  - Green: Strong correlation (>0.7)
  - Blue: Moderate correlation (0.5-0.7)
  - Yellow: Weak correlation (<0.5)

**Tooltip Display:**
- Metric name
- Quality score (1 decimal)
- Revenue impact (2 decimal M)
- Correlation strength (2 decimal)
- NPS score (1 decimal)

### Historical Trends Chart

**Purpose:** Shows 12-month trends in quality, revenue, satisfaction, and churn.

**Data Generation:**
```javascript
const historicalData = Array.from({ length: 12 }, (_, i) => ({
  month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
  quality: Number((70 + Math.random() * 20).toFixed(2)),
  revenue: Number((200 + Math.random() * 100).toFixed(2)),
  satisfaction: Number((75 + Math.random() * 15).toFixed(2)),
  churn: Number((5 - Math.random() * 2).toFixed(2))
}));
```

**Note:** Currently uses simulated data. In production, this would connect to historical business impact data.

**Chart Lines:**
- **Quality Score:** Blue line, left Y-axis
- **Customer Satisfaction:** Purple line, left Y-axis
- **Revenue ($K):** Green line, right Y-axis
- **Churn Rate (%):** Red line, right Y-axis

### Metric Impact Cards

Each quality metric has a detailed impact card with multiple sections:

#### Business Metrics Grid
Displays four key metrics per quality metric:
- **Quality Score:** Current metric value (1 decimal place)
- **Revenue Impact:** Individual metric's revenue impact (2 decimal M)
- **Customer Satisfaction:** NPS score (1 decimal place)
- **Feature Adoption:** Adoption percentage (1 decimal %)

#### Correlation Insights
Shows detailed impact analysis:
- **Revenue Correlation:** Calculates potential revenue gain per 10% quality improvement
- **Customer Impact:** Qualitative assessment of current satisfaction level
- **Adoption Rate:** Assessment of user engagement level

#### Strategic Recommendations
Provides actionable insights:
1. **Prioritization:** Based on correlation strength
2. **Monitoring:** NPS score recommendations
3. **Maximization:** Revenue potential focus areas

#### What-If Scenarios
Shows potential outcomes:
- **Quality Improvement (20%)**: Revenue gain and NPS increase calculations
- **Quality Degradation (10%)**: Revenue loss and NPS decrease calculations

## Data Sources

### Primary Data Source
**API Endpoint:** `GET /api/analytics/business-impact?days=30`

**Response Structure:**
```json
[
  {
    "metric_name": "test_coverage",
    "quality_score": 95.5,
    "revenue_impact": 4178000,
    "customer_satisfaction": 82.3,
    "feature_adoption_rate": 73.1,
    "correlation_strength": 0.85
  }
]
```

### Field Definitions
- **metric_name:** Name of the quality metric (e.g., "test_coverage")
- **quality_score:** Current value of the quality metric (0-100 scale)
- **revenue_impact:** Estimated annual revenue impact in dollars
- **customer_satisfaction:** Net Promoter Score (0-100 scale)
- **feature_adoption_rate:** Percentage of users actively using features (0-100%)
- **correlation_strength:** Statistical correlation coefficient (0-1 scale)

## Calculations Explained

### Correlation Strength Algorithm
The correlation strength is calculated using statistical correlation analysis between:
- Quality metric values (independent variable)
- Business outcomes: revenue, satisfaction, adoption (dependent variables)
- Weighted average of multiple correlation coefficients

### Revenue Impact Calculation
Revenue impact is estimated using:
1. **Historical data analysis** of quality improvements vs. revenue changes
2. **Statistical modeling** to establish causal relationships
3. **Industry benchmarks** adjusted for company size and market
4. **Time-based weighting** (recent data has higher influence)

### Customer Satisfaction (NPS) Correlation
NPS correlation is calculated by:
1. **Survey data analysis** during quality improvement periods
2. **Churn rate analysis** before and after quality changes
3. **Support ticket volume** correlation with quality metrics
4. **Customer feedback** sentiment analysis

### Feature Adoption Rate
Adoption rate correlation considers:
1. **Usage analytics** during quality improvement periods
2. **Feature engagement metrics** vs. quality scores
3. **Time-to-adoption** after quality improvements
4. **User retention** correlation with quality stability

## API Endpoints Used

### Business Impact Data
```
GET /api/analytics/business-impact?days=30
```
- **Purpose:** Retrieves correlation data for quality metrics
- **Parameters:** `days` (optional, defaults to 30)
- **Response:** Array of business impact objects

### Authentication
All endpoints require Bearer token authentication:
```
Authorization: Bearer <token>
```

## Data Refresh and Updates

### Automatic Updates
- **Pipeline Jobs:** Business impact data recalculated daily at 00:30
- **Cache Duration:** 30 minutes for performance
- **Historical Data:** Retained for 12 months for trend analysis

### Manual Triggers
- **Admin Panel:** Force recalculation available
- **Quality Updates:** Automatic recalculation when metrics change
- **Business Events:** Revenue/NPS updates trigger correlation updates

## Interpretation Guidelines

### Correlation Strength Levels
- **Strong (0.71-1.00):** Direct causal relationship likely
- **Moderate (0.31-0.70):** Correlation exists, investigate further
- **Weak (0.00-0.30):** May be coincidental, needs more data

### Revenue Impact Confidence
- **High Confidence:** Based on 6+ months of data, multiple validation points
- **Medium Confidence:** 3-6 months of data, statistical significance
- **Low Confidence:** <3 months of data, preliminary estimates

### Action Thresholds
- **Immediate Action:** Correlation >0.7 AND revenue impact >$1M
- **Monitor Closely:** Correlation >0.5 OR revenue impact >$500K
- **Track Trends:** Correlation >0.3 OR revenue impact >$100K

## Troubleshooting

### Common Issues
1. **No Data Displayed:** Check API connectivity and authentication
2. **Outdated Data:** Verify background job execution
3. **Inconsistent Calculations:** Confirm data source integrity

### Data Validation
- **Revenue Bounds:** $0 - $50M per metric (reasonable limits)
- **Correlation Bounds:** 0.00 - 1.00 (statistical validity)
- **NPS Bounds:** 0 - 100 (survey scale limits)

## Future Enhancements

### Planned Features
1. **Real-time Correlation Updates** (WebSocket integration)
2. **Custom Time Periods** (beyond 30-day default)
3. **Multi-team Analysis** (cross-team correlations)
4. **Predictive Modeling** (forecast revenue impact)
5. **Industry Benchmarks** (comparative analysis)
6. **Automated Recommendations** (AI-powered insights)
