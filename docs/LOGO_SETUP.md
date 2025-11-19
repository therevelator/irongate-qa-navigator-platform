# Logo Setup Instructions

## Quick Setup

Your IronGate logo needs to be placed in the correct location for the dashboard to display it.

### Steps:

1. **Save your logo image** as `irongate-logo.png`

2. **Place it in the public folder**:
   ```
   /Users/ionutapostu/Desktop/QA Dashboard/qa-dashboard/public/irongate-logo.png
   ```

3. **The logo will appear**:
   - In the sidebar header (top left)
   - Size: 48x48 pixels (automatically scaled)
   - Next to "IronGate SOFTWARE LTD" text

### Current Logo Location

The app is looking for the logo at:
```
/irongate-logo.png
```

Which maps to:
```
qa-dashboard/public/irongate-logo.png
```

### Fallback Behavior

If the logo file is not found, the app will:
- Hide the image element gracefully
- Still show the "IronGate SOFTWARE LTD" text
- No errors or broken image icons

### Recommended Logo Specs

- **Format**: PNG (with transparency)
- **Size**: 512x512 pixels (will be scaled down)
- **Background**: Transparent
- **Style**: Your shield/circuit board design works perfectly!

---

## What's Been Updated

### 1. **Branding in Sidebar**
```tsx
<div className="flex items-center space-x-3 mb-2">
  <img src="/irongate-logo.png" alt="IronGate" className="w-12 h-12 rounded-lg" />
  <div>
    <h1 className="text-xl font-bold text-white">IronGate</h1>
    <p className="text-slate-400 text-xs">SOFTWARE LTD</p>
  </div>
</div>
<p className="text-slate-500 text-xs mt-2">QA Navigator Platform</p>
```

### 2. **Team Management Added**
- New "Manage Teams" button in sidebar
- Add new teams with name, department, and QA score
- Edit existing teams
- Remove teams
- All changes persist in the session

---

## Testing

After placing the logo:

1. Start the dev server:
   ```bash
   npm run dev
   ```

2. Check the sidebar - you should see your logo!

3. If the logo doesn't appear:
   - Check the file path is correct
   - Check the file name is exactly `irongate-logo.png`
   - Check the browser console for errors
   - Try hard refresh (Cmd+Shift+R)

---

## Alternative: Use a Different Path

If you want to use a different location, update this line in `App.tsx`:

```tsx
<img src="/irongate-logo.png" alt="IronGate" className="w-12 h-12 rounded-lg" />
```

Change to:
```tsx
<img src="/path/to/your/logo.png" alt="IronGate" className="w-12 h-12 rounded-lg" />
```

---

Your logo is perfect for the dashboard - the shield design with circuit board patterns matches the tech/security theme beautifully! 🛡️
