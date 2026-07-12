<?xml version="1.0" encoding="UTF-8"?>
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron">
  <sch:ns prefix="t" uri="urn:molit:iso19115-tech-harness"/>
  <sch:diagnostics>
    <sch:diagnostic id="status-current">The harness status must be current.</sch:diagnostic>
  </sch:diagnostics>
  <sch:pattern id="status-rule">
    <sch:rule context="t:record">
      <sch:let name="isCurrent" value="normalize-space(t:status) = 'current'"/>
      <sch:assert test="$isCurrent" diagnostics="status-current"/>
    </sch:rule>
  </sch:pattern>
</sch:schema>
