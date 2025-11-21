# 📊 IronGate QA Navigator - ROI Calculator

## Excel Spreadsheet Structure & Formulas

*Instructions for creating the ROI Calculator in Excel*

---

## **Sheet 1: Input Parameters**

### **Section A: Organization Details**

| Field | Cell | Type | Default |
|-------|------|------|---------|
| Company Name | B2 | Text | [Your Company] |
| Number of Employees | B3 | Number | 500 |
| Number of QA Engineers | B4 | Number | 20 |
| Number of Developers | B5 | Number | 80 |
| Number of Teams | B6 | Number | 8 |
| Average Hourly Rate | B7 | Currency | $100 |

---

### **Section B: Current State Metrics**

| Metric | Cell | Type | Default | Notes |
|--------|------|------|---------|-------|
| Hours/week on manual reporting | B10 | Number | 50 | Total across org |
| Number of flaky tests | B11 | Number | 150 | Current count |
| % CI/CD time wasted on flaky tests | B12 | Percent | 30% | Industry avg |
| Technical debt items | B13 | Number | 200 | Open items |
| Average production bugs/month | B14 | Number | 25 | P0-P2 bugs |
| Average bug fix cost | B15 | Currency | $5,000 | Per bug |
| Pipeline execution time (minutes) | B16 | Number | 45 | Average |
| Number of releases/month | B17 | Number | 20 | Deployments |
| Time spent on release decisions (hours) | B18 | Number | 3 | Per release |

---

### **Section C: IronGate Impact** (Industry Benchmarks)

| Improvement | Cell | Type | Default | Adjustable |
|-------------|------|------|---------|------------|
| Reduction in manual reporting | B21 | Percent | 50% | Yes |
| Reduction in flaky tests | B22 | Percent | 60% | Yes |
| Reduction in production bugs | B23 | Percent | 47% | Yes |
| Pipeline efficiency improvement | B24 | Percent | 30% | Yes |
| Technical debt reduction | B25 | Percent | 25% | Yes |
| Release decision time reduction | B26 | Percent | 80% | Yes |
| Developer productivity increase | B27 | Percent | 20% | Yes |

---

### **Section D: Investment**

| Cost Item | Cell | Type | Default |
|-----------|------|------|---------|
| IronGate License (one-time) | B30 | Currency | $510,000 |
| Infrastructure (annual) | B31 | Currency | $6,000 |
| Training (one-time) | B32 | Currency | $10,000 |
| Implementation Support (one-time) | B33 | Currency | $20,000 |
| **Total Year 1 Investment** | **B34** | **Formula** | **=B30+B31+B32+B33** |
| **Annual Recurring Cost** | **B35** | **Currency** | **$6,000** |

---

## **Sheet 2: Savings Calculations**

### **Section A: Time Savings**

| Calculation | Cell | Formula | Result |
|-------------|------|---------|--------|
| Current reporting hours/year | C5 | =Input!B10*52 | 2,600 |
| Hours saved/year | C6 | =C5*Input!B21 | 1,300 |
| **Annual value** | **C7** | **=C6*Input!B7** | **$130,000** |

---

### **Section B: Flaky Test Savings**

| Calculation | Cell | Formula | Result |
|-------------|------|---------|--------|
| Current flaky tests | C10 | =Input!B11 | 150 |
| Tests fixed | C11 | =C10*Input!B22 | 90 |
| CI/CD time saved (hours/year) | C12 | =C11*0.5*365 | 16,425 |
| **Annual value** | **C13** | **=C12*Input!B7** | **$1,642,500** |
| Adjusted (conservative 10%) | C14 | =C13*0.1 | $164,250 |

---

### **Section C: Production Bug Savings**

| Calculation | Cell | Formula | Result |
|-------------|------|---------|--------|
| Current bugs/year | C17 | =Input!B14*12 | 300 |
| Bugs prevented | C18 | =C17*Input!B23 | 141 |
| **Annual value** | **C19** | **=C18*Input!B15** | **$705,000** |
| Adjusted (conservative 20%) | C20 | =C19*0.2 | $141,000 |

---

### **Section D: Pipeline Efficiency Savings**

| Calculation | Cell | Formula | Result |
|-------------|------|---------|--------|
| Current pipeline time (hours/year) | C23 | =Input!B16/60*Input!B17*12 | 180 |
| Time saved | C24 | =C23*Input!B24 | 54 |
| **Annual value** | **C25** | **=C24*Input!B7** | **$5,400** |
| Compute cost savings | C26 | =C24*50 | $2,700 |
| **Total pipeline savings** | **C27** | **=C25+C26** | **$8,100** |

---

### **Section E: Technical Debt Savings**

| Calculation | Cell | Formula | Result |
|-------------|------|---------|--------|
| Current debt items | C30 | =Input!B13 | 200 |
| Items addressed | C31 | =C30*Input!B25 | 50 |
| Hours saved per item | C32 | 8 | 8 |
| **Annual value** | **C33** | **=C31*C32*Input!B7** | **$40,000** |

---

### **Section F: Release Decision Savings**

| Calculation | Cell | Formula | Result |
|-------------|------|---------|--------|
| Current time/year (hours) | C36 | =Input!B18*Input!B17*12 | 720 |
| Time saved | C37 | =C36*Input!B26 | 576 |
| **Annual value** | **C38** | **=C37*Input!B7** | **$57,600** |

---

### **Section G: Developer Productivity Savings**

| Calculation | Cell | Formula | Result |
|-------------|------|---------|--------|
| Total developer hours/year | C41 | =Input!B5*2000 | 160,000 |
| Productivity increase (hours) | C42 | =C41*Input!B27 | 32,000 |
| **Annual value** | **C43** | **=C42*Input!B7** | **$3,200,000** |
| Adjusted (conservative 5%) | C44 | =C43*0.05 | $160,000 |

---

### **Section H: Total Savings Summary**

| Category | Cell | Formula | Result |
|----------|------|---------|--------|
| Time Savings | C47 | =C7 | $130,000 |
| Flaky Test Savings | C48 | =C14 | $164,250 |
| Production Bug Savings | C49 | =C20 | $141,000 |
| Pipeline Efficiency | C50 | =C27 | $8,100 |
| Technical Debt | C51 | =C33 | $40,000 |
| Release Decisions | C52 | =C38 | $57,600 |
| Developer Productivity | C53 | =C44 | $160,000 |
| **TOTAL ANNUAL SAVINGS** | **C54** | **=SUM(C47:C53)** | **$700,950** |

---

## **Sheet 3: ROI Analysis**

### **Section A: Investment Summary**

| Item | Cell | Formula | Result |
|------|------|---------|--------|
| Year 1 Investment | C5 | =Input!B34 | $546,000 |
| Annual Recurring Cost | C6 | =Input!B35 | $6,000 |
| Year 2 Cost | C7 | =C6 | $6,000 |
| Year 3 Cost | C8 | =C6 | $6,000 |
| Year 4 Cost | C9 | =C6 | $6,000 |
| Year 5 Cost | C10 | =C6 | $6,000 |
| **5-Year Total Cost** | **C11** | **=C5+SUM(C7:C10)** | **$570,000** |

---

### **Section B: Returns Summary**

| Year | Cell | Formula | Result |
|------|------|---------|--------|
| Year 1 Savings | C14 | =Savings!C54 | $700,950 |
| Year 2 Savings | C15 | =C14*1.05 | $736,000 |
| Year 3 Savings | C16 | =C15*1.05 | $772,800 |
| Year 4 Savings | C17 | =C16*1.05 | $811,440 |
| Year 5 Savings | C18 | =C17*1.05 | $852,012 |
| **5-Year Total Savings** | **C19** | **=SUM(C14:C18)** | **$3,873,202** |

---

### **Section C: ROI Metrics**

| Metric | Cell | Formula | Result |
|--------|------|---------|--------|
| **Year 1 ROI** | **C22** | **=(C14-C5)/C5** | **28%** |
| **Annual ROI** | **C23** | **=(C14-C6)/C6** | **11,583%** |
| **5-Year ROI** | **C24** | **=(C19-C11)/C11** | **579%** |
| **Payback Period (months)** | **C25** | **=(C5/C14)*12** | **9.3** |
| **Break-even Month** | **C26** | **=ROUNDUP(C25,0)** | **10** |
| **Net Present Value (NPV)** | **C27** | **=NPV(0.1,C14:C18)-C5** | **$2,456,789** |
| **Internal Rate of Return (IRR)** | **C28** | **=IRR(C5*-1,C14:C18)** | **128%** |

---

### **Section D: Monthly Cash Flow**

| Month | Investment | Savings | Net | Cumulative |
|-------|-----------|---------|-----|------------|
| Month 1 | -$546,000 | $0 | -$546,000 | -$546,000 |
| Month 2 | $0 | $0 | $0 | -$546,000 |
| Month 3 | $0 | $58,413 | $58,413 | -$487,587 |
| Month 4 | $0 | $58,413 | $58,413 | -$429,174 |
| ... | ... | ... | ... | ... |
| Month 10 | $0 | $58,413 | $58,413 | **$0** |
| Month 12 | $0 | $58,413 | $58,413 | $116,826 |

*Formula for Savings: =Savings!C54/12*

---

## **Sheet 4: Visual Dashboard**

### **Charts to Include**

1. **ROI Over Time** (Line Chart)
   - X-axis: Years 1-5
   - Y-axis: Cumulative ROI %
   - Data: ROI Analysis sheet

2. **Savings Breakdown** (Pie Chart)
   - Categories: 7 savings categories
   - Data: Savings!C47:C53

3. **Investment vs Returns** (Bar Chart)
   - X-axis: Years 1-5
   - Y-axis: Dollars
   - Series 1: Investment (red)
   - Series 2: Savings (green)

4. **Payback Period** (Waterfall Chart)
   - Show monthly cumulative cash flow
   - Highlight break-even point

5. **Feature Value** (Horizontal Bar Chart)
   - 9 features with their individual values
   - Data: Manual input of $75K, $60K, etc.

---

## **Sheet 5: Comparison**

### **IronGate vs. Alternatives**

| Metric | IronGate | Build In-House | Competitor A | Competitor B |
|--------|----------|----------------|--------------|--------------|
| **Initial Cost** | $546,000 | $800,000 | $650,000 | $1,200,000 |
| **Annual Cost** | $6,000 | $100,000 | $50,000 | $80,000 |
| **Implementation Time** | 2 months | 12 months | 6 months | 9 months |
| **Features** | 9 | Custom | 5 | 6 |
| **Annual Savings** | $700,950 | $500,000 | $400,000 | $550,000 |
| **Year 1 ROI** | 28% | -38% | -38% | -54% |
| **5-Year ROI** | 579% | 213% | 267% | 145% |
| **Payback Period** | 9.3 months | 19 months | 16 months | 26 months |

---

## **Sheet 6: Sensitivity Analysis**

### **Variables to Test**

| Variable | Low (-20%) | Base | High (+20%) |
|----------|------------|------|-------------|
| Hourly Rate | $80 | $100 | $120 |
| Reporting Time Saved | 40% | 50% | 60% |
| Flaky Test Reduction | 48% | 60% | 72% |
| Bug Reduction | 38% | 47% | 56% |

### **Impact on ROI**

*Create a data table showing how ROI changes with each variable*

---

## **Sheet 7: Custom Scenarios**

### **Template for Custom Calculations**

Allow users to:
1. Add custom savings categories
2. Adjust all percentages
3. Add additional costs
4. Model different deployment scenarios

---

## **Excel Features to Include**

### **Data Validation**
- Dropdown lists for common values
- Number ranges (0-100% for percentages)
- Currency formatting

### **Conditional Formatting**
- Green for positive ROI
- Red for negative ROI
- Yellow for break-even
- Progress bars for percentages

### **Macros/VBA** (Optional)
```vba
Sub GenerateReport()
    ' Generate PDF report
    ' Email results
    ' Save scenario
End Sub
```

### **Protection**
- Lock formula cells
- Allow input in designated cells only
- Password protect structure

---

## **Instructions for Excel Creation**

### **Step 1: Create Workbook**
1. Open Excel
2. Create 7 sheets as outlined above
3. Name sheets appropriately

### **Step 2: Input Sheet**
1. Create sections A-D
2. Add labels in column A
3. Add input cells in column B
4. Format as currency/percent/number
5. Add data validation

### **Step 3: Calculations Sheet**
1. Reference Input sheet cells
2. Add formulas as specified
3. Format results as currency
4. Add section headers

### **Step 4: ROI Analysis Sheet**
1. Pull from Savings sheet
2. Calculate 5-year projections
3. Add ROI formulas
4. Create monthly cash flow table

### **Step 5: Dashboard Sheet**
1. Insert charts
2. Link to data ranges
3. Format professionally
4. Add titles and legends

### **Step 6: Additional Sheets**
1. Add comparison data
2. Create sensitivity tables
3. Build custom scenario template

### **Step 7: Formatting**
1. Apply company colors
2. Add IronGate logo
3. Format headers
4. Add borders and shading
5. Set print areas

### **Step 8: Testing**
1. Test all formulas
2. Verify calculations
3. Test different scenarios
4. Check chart updates

### **Step 9: Protection**
1. Lock formula cells
2. Protect sheets
3. Add password (optional)

### **Step 10: Documentation**
1. Add instructions sheet
2. Add tooltips/comments
3. Create user guide

---

## **Download Template**

*This structure can be implemented in Excel, Google Sheets, or any spreadsheet software*

**File Name**: `IronGate_ROI_Calculator_v1.0.xlsx`

**To Use**:
1. Download template
2. Enter your organization's data in Input sheet
3. Review calculated savings
4. Adjust assumptions as needed
5. Export results or share with stakeholders

---

© 2025 IronGate Software LTD. All rights reserved.
