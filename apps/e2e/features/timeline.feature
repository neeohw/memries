Feature: Timeline periods
  Year / month / week headings follow capture time. The pinned
  label follows the first visible Timeline Group.

  Scenario: Granularity headings include an ISO week range
    Given I am signed in
    When I group memories by "Year"
    Then I should see the period heading "2026"
    When I group memories by "Month"
    Then I should see the period heading "August 2026"
    When I group memories by "Week"
    Then I should see the period heading "31 Aug – 6 Sep 2026"
    And I should see the period heading "24–30 Aug 2026"

  Scenario: Ctrl and the wheel zoom the timeline
    Given I am signed in
    Then memories should be grouped by "month"
    When I zoom in with the wheel
    Then memories should be grouped by "week"

  Scenario: Current period label follows scroll
    Given I am signed in
    When I group memories by "Week"
    Then the current period should be "31 Aug – 6 Sep 2026"
    When I scroll until I see the memory from "Wednesday, 15 March 2023"
    Then the current period should be "13–19 Mar 2023"

  Scenario: A period heading drills into itself
    Given I am signed in
    When I group memories by "Year"
    And I click the period heading "2025"
    Then memories should be grouped by "month"
    And the current period should be "December 2025"

  Scenario: The zoom level survives a reload in the same tab
    Given I am signed in
    When I group memories by "Year"
    And I reload the page
    Then memories should be grouped by "year"

  Scenario: Zoom stops at both ends of the ladder
    Given I am signed in
    When I group memories by "Week"
    Then I cannot zoom in any further
    When I group memories by "Year"
    Then I cannot zoom out any further

  @future @skip
  Scenario: Loading more memories shows a spinner
    Given I am signed in
    When I scroll to the end of the timeline
    Then I should see "Loading more memories…"
