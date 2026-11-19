Feature: Sign in
  The password form puts the reader on Memories.

  Scenario: Admin sees memories after login
    Given I am signed in
    Then I should see my memories
