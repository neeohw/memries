Feature: Empty library states
  Favorites and a new Album explain themselves when they have nothing to
  show.

  Scenario: Favorites explains an empty heart list
    Given I am signed in
    When I open the "Favorites" tab
    Then I should see the empty favorites state


  Scenario: A new album explains it has no photos yet
    Given I am signed in
    When I open an empty album named "Holiday"
    Then I should see the empty album state

  @future @skip
  Scenario: An empty library offers to scan the folder
    Given the library has no photos
    When I am signed in
    Then I should see the empty library state
    And I should see the button "Scan your folder"
