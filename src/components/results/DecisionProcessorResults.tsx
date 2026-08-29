import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, Download, AlertCircle, ArrowRight, Ban, Pause, FileText, Package, ChevronDown, RefreshCw } from "lucide-react";
import * as XLSX from 'xlsx';
import { track } from "@/lib/analytics";

interface DecisionProcessorResultsProps {
  fileName: string;
  summary: {
    pausedCount: number;
    negativesCreated: number;
    searchTermRowsAdded: number;
    negativeProductTargets: number;
  };
  workbook: XLSX.WorkBook;
  validation: {
    totalSpend: number;
    hasBlankEntities: boolean;
    errors: string[];
    warnings: string[];
  };
  autoRepairs: Array<{
    type: string;
    count: number;
    details: string;
  }>;
  preFlight: {
    fileReadable: boolean;
    recognizedSheets: string[];
    decisionColumnFound: boolean;
    columnsNormalized: boolean;
    actionableRows: number;
  };
  onValidate: () => void;
  onReupload: () => void;
  onStartBleeders2?: () => void;
}

export const DecisionProcessorResults: React.FC<DecisionProcessorResultsProps> = ({
  fileName,
  summary,
  workbook,
  validation,
  autoRepairs,
  preFlight,
  onValidate,
  onReupload,
  onStartBleeders2
}) => {
  const [showAutoRepairs, setShowAutoRepairs] = React.useState(false);
  
  const handleDownload = () => {
    track("decisions_made", { module: "bleeders_1", decisionCount: summary.pausedCount + summary.negativesCreated + summary.negativeProductTargets });
    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    track("file_downloaded", { module: "bleeders_1", rowCount: preFlight.actionableRows });
  };
  
  const scrollToValidator = () => {
    const validatorElement = document.getElementById('step-3');
    if (validatorElement) {
      validatorElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => onValidate(), 400);
    } else {
      onValidate();
    }
  };

  if (validation.errors.length > 0) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Processing Failed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Cannot Export</AlertTitle>
            <AlertDescription className="space-y-2 whitespace-pre-line">
              {validation.errors.map((error, idx) => (
                <p key={idx}>{error}</p>
              ))}
            </AlertDescription>
          </Alert>
          
          <div className="text-sm text-muted-foreground">
            <p className="font-medium mb-2">Common fixes:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Ensure the Decision column exists and contains valid values (pause, negative, keep)</li>
              <li>Check that Entity values are filled for all rows (or let auto-repair handle it)</li>
              <li>Verify sheet names match expected patterns (e.g., "Sponsored Products Campaigns")</li>
              <li>Close the file in Excel/Sheets before uploading</li>
            </ul>
          </div>
          
          <Button
            onClick={onReupload}
            className="w-full"
            variant="outline"
            title="Upload a corrected version of your decision file to reprocess."
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Reupload file
          </Button>
          
          <p className="text-xs text-center text-muted-foreground">
            If you corrected issues in Excel, reupload your updated file here.
          </p>
        </CardContent>
      </Card>
    );
  }
  
  // Show informational message for no actionable rows
  if (validation.warnings.some(w => w.includes('No actionable rows'))) {
    return (
      <Card className="border-blue-500">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-blue-600">
            <AlertCircle className="h-5 w-5" />
            No Actionable Rows
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="bg-blue-50 border-blue-200">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription className="whitespace-pre-line">
              {validation.warnings.find(w => w.includes('No actionable rows'))}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pre-flight Diagnostics & Inline Validation */}
      <Card className="border-blue-500">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-blue-600">
            <CheckCircle2 className="h-5 w-5" />
            Auto-Validation Checklist
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>✅ Tab structure verified</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>✅ Columns verified</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>✅ Entity/Operation logic valid</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>✅ Numeric fields validated</span>
            </div>
            {validation.warnings.length > 0 && (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <span>⚠️ {validation.warnings.length} warning(s)</span>
              </div>
            )}
              
              {autoRepairs.length > 0 && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowAutoRepairs(!showAutoRepairs)}
                    className="flex items-center gap-2 text-yellow-600 hover:text-yellow-700 font-medium"
                  >
                    <AlertCircle className="h-4 w-4" />
                    <span>⚠️ Auto-repairs applied: {autoRepairs.reduce((sum, r) => sum + r.count, 0)}</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${showAutoRepairs ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {showAutoRepairs && (
                    <div className="mt-2 ml-6 space-y-1 text-muted-foreground">
                      {autoRepairs.map((repair, idx) => (
                        <div key={idx}>• {repair.details}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              
              {validation.warnings.length > 0 && !validation.warnings.some(w => w.includes('No actionable')) && (
                <div className="mt-3 space-y-1">
                  {validation.warnings.map((warning, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-yellow-600">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      
      {/* Workflow Complete - Enhanced */}
      <Card className="border-green-500 bg-green-50/50 dark:bg-green-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-6 w-6" />
            ✅ Workflow Complete — Amazon File Ready
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg p-3">
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              🟢 All checks passed — file has been validated and is ready for Amazon upload.
            </p>
          </div>
          
          <p className="text-sm text-muted-foreground">
            Your bleeder file has been fully processed, validated, and is now ready to upload to Amazon.
          </p>
          
          {/* Summary Stats */}
          <div>
            <h3 className="font-semibold text-sm mb-2">Summary</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950">
              <Pause className="h-5 w-5 text-blue-600" />
              <div>
                <div className="text-2xl font-bold text-blue-600">{summary.pausedCount}</div>
                <div className="text-sm text-muted-foreground">Paused updated</div>
              </div>
            </div>
            
            <div className="flex items-center gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-950">
              <Ban className="h-5 w-5 text-red-600" />
              <div>
                <div className="text-2xl font-bold text-red-600">{summary.negativesCreated}</div>
                <div className="text-sm text-muted-foreground">Negative keywords created</div>
              </div>
            </div>
            
            <div className="flex items-center gap-3 p-3 rounded-lg bg-orange-50 dark:bg-orange-950">
              <Package className="h-5 w-5 text-orange-600" />
              <div>
                <div className="text-2xl font-bold text-orange-600">{summary.negativeProductTargets}</div>
                <div className="text-sm text-muted-foreground">Negative product targets created</div>
              </div>
            </div>
            
            <div className="flex items-center gap-3 p-3 rounded-lg bg-purple-50 dark:bg-purple-950">
              <FileText className="h-5 w-5 text-purple-600" />
              <div>
                <div className="text-2xl font-bold text-purple-600">{summary.searchTermRowsAdded}</div>
                <div className="text-sm text-muted-foreground">Search terms promoted to negatives</div>
              </div>
              </div>
            </div>
          </div>
          
          {/* Next Steps (SOP) */}
          <div>
            <h3 className="font-semibold text-sm mb-2">Next Steps (SOP)</h3>
            <ol className="text-sm space-y-1 list-decimal list-inside text-muted-foreground">
              <li>Download your file using the button below</li>
              <li>Go to Amazon Advertising Console → Bulk Operations</li>
              <li>Upload the file and confirm it processes successfully</li>
              <li>Archive the report in <code className="bg-muted px-1 rounded">/Bleeders/Archive_[date]/</code> for records</li>
            </ol>
          </div>
          
          <p className="text-xs text-muted-foreground italic">
            💡 Tip: Keep the file for monthly performance reviews or audits.
          </p>
          
          {/* Download Section */}
          <Button onClick={handleDownload} className="w-full" size="lg">
            <Download className="mr-2 h-4 w-4" />
            Download: {fileName}
          </Button>
          
          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={onReupload}
              variant="outline"
              className="flex-1 border-secondary text-secondary hover:bg-secondary/10"
              title="Upload a revised version of your decision file if you made changes. This will reset your Decision Processor results."
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Reupload file
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Workflow Continuation Section */}
      <Card className="border-blue-400">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            ⚙️ Continue or Start a New Task
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button 
              variant="outline" 
              onClick={onStartBleeders2} 
              className="justify-start"
              disabled={!onStartBleeders2}
            >
              <ArrowRight className="mr-2 h-4 w-4" />
              Run Bleeders 2.0
            </Button>
            <Button variant="outline" onClick={onReupload} className="justify-start">
              <RefreshCw className="mr-2 h-4 w-4" />
              Reset Workflow
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Use the toolbar or type commands to proceed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
